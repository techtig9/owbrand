import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPublishingWorker } from '@/lib/publishing/worker';
import { PublishError } from '@/lib/social/errors';

/**
 * The publishing worker's decision-making.
 *
 * The atomic claim and the state machine are proven against real Postgres in
 * supabase/test/rls-tests.sql — a mock cannot demonstrate `for update skip
 * locked`. What is asserted here is what the worker DOES with each result:
 * which outcome it records, whether it schedules a retry, and — the one that
 * matters most — that it never publishes a post that is already published.
 */

const { adapterPublish, recordAccountError, recordAccountSuccess, accountForBrandPlatform } = vi.hoisted(() => ({
  adapterPublish: vi.fn(),
  recordAccountError: vi.fn(),
  recordAccountSuccess: vi.fn(),
  accountForBrandPlatform: vi.fn(),
}));

vi.mock('@/lib/social/providers/registry', () => ({
  adapterFor: () => ({ platform: 'instagram', publish: adapterPublish }),
  hasImplementation: () => true,
}));

vi.mock('@/lib/social/account-store', () => ({
  accountForBrandPlatform,
  recordAccountError,
  recordAccountSuccess,
  accountHealth: () => ({ status: 'active', expiresInDays: 40, missingScopes: [], usable: true }),
}));

const HEALTHY_ACCOUNT = { id: 'acct-1', platform: 'instagram', external_account_id: 'ig-1' };

const JOB = {
  id: 'job-1',
  social_post_id: 'post-1',
  brand_id: 'brand-1',
  social_account_id: 'acct-1',
  platform: 'instagram',
  status: 'claimed',
  attempts: 0,
  max_attempts: 5,
  scheduled_for: null,
  idempotency_key: 'idem-1',
};

const POST = {
  id: 'post-1',
  brand_id: 'brand-1',
  status: 'queued',
  caption: 'hello',
  media_urls: ['https://cdn.test/a.jpg'],
  external_post_id: null,
  external_url: null,
};

/**
 * A Supabase-shaped fake that records the RPCs the worker issues. Only the
 * calls the worker actually makes are implemented — anything else throwing is
 * a useful signal that the worker changed.
 */
function fakeDb(options: { jobs?: unknown[]; post?: unknown } = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];

  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_publishing_jobs') return { data: options.jobs ?? [JOB], error: null };
      return { data: null, error: null };
    }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        update: (patch: Record<string, unknown>) => {
          updates.push({ table, patch });
          return builder;
        },
        maybeSingle: async () =>
          table === 'social_posts' ? { data: options.post ?? POST, error: null } : { data: null, error: null },
      });
      return builder;
    },
  };

  return { db: db as never, rpcCalls, updates };
}

function completion(rpcCalls: Array<{ name: string; args: Record<string, unknown> }>) {
  return rpcCalls.find((call) => call.name === 'complete_publishing_job')?.args;
}

beforeEach(() => {
  adapterPublish.mockReset();
  recordAccountError.mockReset();
  recordAccountSuccess.mockReset();
  accountForBrandPlatform.mockReset();
  accountForBrandPlatform.mockResolvedValue(HEALTHY_ACCOUNT);
});

describe('a successful publish', () => {
  it('records the external ids and clears the account error state', async () => {
    adapterPublish.mockResolvedValue({
      externalPostId: 'ig_123',
      externalUrl: 'https://instagram.com/p/abc',
    });

    const { db, rpcCalls } = fakeDb();
    const result = await runPublishingWorker({ db, workerId: 'w1' });

    expect(result.published).toBe(1);
    expect(completion(rpcCalls)).toMatchObject({
      p_outcome: 'published',
      p_external_post_id: 'ig_123',
      p_external_url: 'https://instagram.com/p/abc',
      p_retry_delay_seconds: null,
    });
    expect(recordAccountSuccess).toHaveBeenCalledWith('acct-1', expect.anything());
  });

  it('passes the caption and media through to the adapter', async () => {
    adapterPublish.mockResolvedValue({ externalPostId: 'ig_123', externalUrl: null });

    const { db } = fakeDb();
    await runPublishingWorker({ db });

    expect(adapterPublish).toHaveBeenCalledWith(
      expect.objectContaining({ caption: 'hello', mediaUrls: ['https://cdn.test/a.jpg'], isVideo: false }),
      HEALTHY_ACCOUNT
    );
  });

  it('detects video from the media url', async () => {
    adapterPublish.mockResolvedValue({ externalPostId: 'ig_123', externalUrl: null });

    const { db } = fakeDb({ post: { ...POST, media_urls: ['https://cdn.test/reel.mp4'] } });
    await runPublishingWorker({ db });

    expect(adapterPublish.mock.calls[0][0].isVideo).toBe(true);
  });
});

describe('a post that is already published', () => {
  it('never calls the adapter again', async () => {
    // The one irreversible mistake in this system. A lost completion write, or
    // a duplicate job, must not produce a second public post.
    const { db, rpcCalls } = fakeDb({
      post: { ...POST, status: 'published', external_post_id: 'ig_existing', external_url: 'https://ig/p/x' },
    });

    const result = await runPublishingWorker({ db });

    expect(adapterPublish).not.toHaveBeenCalled();
    expect(result.published).toBe(1);
    expect(completion(rpcCalls)).toMatchObject({
      p_outcome: 'published',
      p_external_post_id: 'ig_existing',
    });
  });
});

describe('a cancelled post', () => {
  it('is skipped, not failed', async () => {
    const { db, rpcCalls } = fakeDb({ post: { ...POST, status: 'cancelled' } });
    const result = await runPublishingWorker({ db });

    expect(adapterPublish).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(completion(rpcCalls)?.p_outcome).toBe('skipped');
  });
});

describe('failures', () => {
  it('schedules a retry for a transient failure', async () => {
    adapterPublish.mockRejectedValue(new PublishError('retryable', 'meta_http_500', 'Meta is down.'));

    const { db, rpcCalls } = fakeDb();
    const result = await runPublishingWorker({ db });

    expect(result.retrying).toBe(1);
    const args = completion(rpcCalls)!;
    expect(args.p_outcome).toBe('retryable_failure');
    expect(args.p_retry_delay_seconds).toBeGreaterThan(0);
  });

  it('honours a provider Retry-After for the retry delay', async () => {
    adapterPublish.mockRejectedValue(
      new PublishError('retryable', 'meta_throttled_4', 'Rate limited.', { retryAfterSeconds: 1800 })
    );

    const { db, rpcCalls } = fakeDb();
    await runPublishingWorker({ db });

    expect(completion(rpcCalls)?.p_retry_delay_seconds).toBe(1800);
  });

  it('stops retrying at the attempt ceiling', async () => {
    adapterPublish.mockRejectedValue(new PublishError('retryable', 'meta_http_500', 'Still down.'));

    // attempts: 4 means this is the fifth and final try.
    const { db, rpcCalls } = fakeDb({ jobs: [{ ...JOB, attempts: 4 }] });
    const result = await runPublishingWorker({ db });

    expect(result.failed).toBe(1);
    const args = completion(rpcCalls)!;
    expect(args.p_outcome).toBe('permanent_failure');
    expect(args.p_retry_delay_seconds).toBeNull();
  });

  it('never retries a permanent failure', async () => {
    adapterPublish.mockRejectedValue(new PublishError('permanent', 'media_rejected', 'Bad aspect ratio.'));

    const { db, rpcCalls } = fakeDb();
    const result = await runPublishingWorker({ db });

    expect(result.failed).toBe(1);
    expect(completion(rpcCalls)?.p_retry_delay_seconds).toBeNull();
  });

  it('flags the account when the credential is the problem', async () => {
    adapterPublish.mockRejectedValue(new PublishError('needs_reconnect', 'meta_auth_190', 'Token expired.'));

    const { db, rpcCalls } = fakeDb();
    const result = await runPublishingWorker({ db });

    expect(result.failed).toBe(1);
    expect(completion(rpcCalls)?.p_outcome).toBe('needs_reconnect');
    // Without this the user only ever sees a failed post, never the cause.
    expect(recordAccountError).toHaveBeenCalled();
  });

  it('treats an unexpected non-PublishError as retryable', async () => {
    // A bug in our own code should not permanently kill a user's post.
    adapterPublish.mockRejectedValue(new TypeError('cannot read property of undefined'));

    const { db, rpcCalls } = fakeDb();
    const result = await runPublishingWorker({ db });

    expect(result.retrying).toBe(1);
    expect(completion(rpcCalls)?.p_error_code).toBe('unexpected_error');
  });

  it('fails permanently when no account is connected', async () => {
    accountForBrandPlatform.mockResolvedValue(null);

    const { db, rpcCalls } = fakeDb();
    const result = await runPublishingWorker({ db });

    expect(adapterPublish).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(completion(rpcCalls)?.p_error_code).toBe('no_connected_account');
  });

  it('truncates a huge provider message before storing it', async () => {
    adapterPublish.mockRejectedValue(new PublishError('permanent', 'x', 'y'.repeat(5000)));

    const { db, rpcCalls } = fakeDb();
    await runPublishingWorker({ db });

    expect((completion(rpcCalls)?.p_error_message as string).length).toBeLessThanOrEqual(1000);
  });
});

describe('batching', () => {
  it('claims with a bounded batch size and a worker id', async () => {
    const { db, rpcCalls } = fakeDb({ jobs: [] });
    await runPublishingWorker({ db, batchSize: 500, workerId: 'w-explicit' });

    const claim = rpcCalls.find((call) => call.name === 'claim_publishing_jobs')!;
    expect(claim.args.p_worker_id).toBe('w-explicit');
    // An unbounded limit would let one invocation lease every job and then
    // time out holding all of them.
    expect(claim.args.p_limit).toBe(25);
  });

  it('returns immediately when nothing is due', async () => {
    const { db } = fakeDb({ jobs: [] });
    const result = await runPublishingWorker({ db });

    expect(result.claimed).toBe(0);
    expect(adapterPublish).not.toHaveBeenCalled();
  });

  it('keeps processing after one job fails', async () => {
    // One permanently broken post must not block every other tenant's queue.
    adapterPublish
      .mockRejectedValueOnce(new PublishError('permanent', 'bad', 'nope'))
      .mockResolvedValueOnce({ externalPostId: 'ig_2', externalUrl: null });

    const { db } = fakeDb({
      jobs: [JOB, { ...JOB, id: 'job-2', social_post_id: 'post-2' }],
    });

    const result = await runPublishingWorker({ db });

    expect(result.claimed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.published).toBe(1);
  });

  it('generates a distinct worker id per run when none is given', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const { db } = fakeDb({ jobs: [] });
      ids.add((await runPublishingWorker({ db })).workerId);
    }
    // Two runs sharing an id could reclaim each other's leases.
    expect(ids.size).toBe(5);
  });
});
