import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { adapterFor } from '@/lib/social/providers/registry';
import {
  accountForBrandPlatform,
  recordAccountError,
  recordAccountSuccess,
  accountHealth,
  type SocialAccountRow,
} from '@/lib/social/account-store';
import { PublishError } from '@/lib/social/errors';
import { isSocialPlatform, type SocialPlatform } from '@/lib/social/platforms';
import { decideRetry, DEFAULT_MAX_ATTEMPTS } from './retry-policy';
import { logger } from '@/lib/logger';

/**
 * The publishing worker.
 *
 * What this replaces: `executePublishingJob()` took a job object handed to it
 * by a caller — including an `accessTokenRef` — looked up an injected
 * registry, and returned the adapter's result. It never claimed a job, never
 * recorded an outcome, never retried, and nothing ever called it. The comment
 * called it a "Phase 6 worker boundary".
 *
 * This one owns the whole lifecycle:
 *
 *   claim (atomic lease) → resolve credential → publish → record outcome
 *
 * Correctness properties, in order of how much they matter:
 *
 *   1. NO DOUBLE PUBLISH. Jobs are leased by `claim_publishing_jobs()` using
 *      `for update skip locked`, so two overlapping invocations take disjoint
 *      sets. A social post cannot be un-published, so this is the one property
 *      worth designing everything else around.
 *   2. A crashed worker recovers. The lease expires and the job becomes
 *      claimable again, rather than being stuck in 'claimed' forever.
 *   3. Every attempt is recorded before the lease is released, in one
 *      transaction (`complete_publishing_job`), so a failure always has a
 *      logged reason.
 *   4. Attempts are counted in the database, so a worker cannot exceed the
 *      ceiling by restarting.
 */

type Db = SupabaseClient<any, any, any>;

/** How long a claim is held. Longer than the slowest Instagram carousel. */
const LEASE_SECONDS = 420;
const DEFAULT_BATCH = 5;

export interface PublishingJobRow {
  id: string;
  social_post_id: string;
  brand_id: string | null;
  platform: string;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_for: string | null;
  idempotency_key: string;
}

export interface WorkerResult {
  workerId: string;
  claimed: number;
  published: number;
  retrying: number;
  failed: number;
  skipped: number;
  outcomes: Array<{
    jobId: string;
    platform: string;
    outcome: string;
    errorKind?: string;
    errorCode?: string;
  }>;
}

/**
 * Runs one worker pass.
 *
 * Returns a summary rather than throwing: a single bad job must not abort the
 * batch, or one permanently broken post would block every other tenant's
 * queue behind it.
 */
export async function runPublishingWorker(
  options: { batchSize?: number; workerId?: string; db?: Db } = {}
): Promise<WorkerResult> {
  const db = options.db ?? supabaseAdmin();
  const workerId = options.workerId ?? `worker_${randomUUID().slice(0, 12)}`;
  const batchSize = Math.min(Math.max(options.batchSize ?? DEFAULT_BATCH, 1), 25);

  const result: WorkerResult = {
    workerId,
    claimed: 0,
    published: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
    outcomes: [],
  };

  const { data, error } = await db.rpc('claim_publishing_jobs', {
    p_worker_id: workerId,
    p_limit: batchSize,
    p_lease_seconds: LEASE_SECONDS,
  });

  if (error) {
    logger.error('publishing_worker:claim_failed', error, { workerId });
    throw error;
  }

  const jobs = (data ?? []) as PublishingJobRow[];
  result.claimed = jobs.length;

  if (jobs.length === 0) return result;

  logger.info('publishing_worker:claimed', { workerId, count: jobs.length });

  // Sequential, not Promise.all: concurrent publishes to the same Page share a
  // rate-limit budget, and tripping it would fail the whole batch instead of
  // one job.
  for (const job of jobs) {
    const outcome = await processJob(job, db);
    result.outcomes.push({ jobId: job.id, platform: job.platform, ...outcome });

    if (outcome.outcome === 'published') result.published += 1;
    else if (outcome.outcome === 'retryable_failure') result.retrying += 1;
    else if (outcome.outcome === 'skipped') result.skipped += 1;
    else result.failed += 1;
  }

  return result;
}

interface JobOutcome {
  outcome: 'published' | 'retryable_failure' | 'permanent_failure' | 'needs_reconnect' | 'skipped';
  errorKind?: string;
  errorCode?: string;
}

async function processJob(job: PublishingJobRow, db: Db): Promise<JobOutcome> {
  const startedAt = Date.now();

  try {
    const post = await loadPost(job, db);

    // The post was cancelled after the job was queued. Not a failure.
    if (post.status === 'cancelled') {
      await complete(job, db, { outcome: 'skipped', errorMessage: 'The post was cancelled.', durationMs: Date.now() - startedAt });
      return { outcome: 'skipped' };
    }

    // Already published — by an earlier attempt whose completion write was
    // lost, or by a duplicate job. Recording success again is correct and
    // idempotent; publishing again would post twice.
    if (post.status === 'published' && post.external_post_id) {
      logger.info('publishing_worker:already_published', { jobId: job.id, postId: post.id });
      await complete(job, db, {
        outcome: 'published',
        externalPostId: post.external_post_id,
        externalUrl: post.external_url,
        durationMs: Date.now() - startedAt,
      });
      return { outcome: 'published' };
    }

    if (!isSocialPlatform(job.platform)) {
      throw new PublishError('permanent', 'unknown_platform', `"${job.platform}" is not a platform OwBrand knows about.`);
    }

    const platform: SocialPlatform = job.platform;
    const brandId = job.brand_id ?? post.brand_id;

    const account = await resolveAccount(brandId, platform, db);

    await markPublishing(job.id, post.id, db);

    const adapter = adapterFor(platform);

    const outcome = await adapter.publish(
      {
        socialPostId: post.id,
        brandId,
        caption: post.caption ?? undefined,
        mediaUrls: normalizeMediaUrls(post.media_urls),
        isVideo: looksLikeVideo(post.media_urls),
      },
      account
    );

    await recordAccountSuccess(account.id, db);

    await complete(job, db, {
      outcome: 'published',
      externalPostId: outcome.externalPostId,
      externalUrl: outcome.externalUrl,
      providerResponse: outcome.providerResponse,
      durationMs: Date.now() - startedAt,
    });

    logger.info('publishing_worker:published', {
      jobId: job.id,
      postId: post.id,
      platform,
      externalPostId: outcome.externalPostId,
    });

    return { outcome: 'published' };
  } catch (error) {
    return handleFailure(job, error, Date.now() - startedAt, db);
  }
}

async function handleFailure(job: PublishingJobRow, error: unknown, durationMs: number, db: Db): Promise<JobOutcome> {
  const publishError =
    error instanceof PublishError
      ? error
      : new PublishError('retryable', 'unexpected_error', error instanceof Error ? error.message : String(error));

  const maxAttempts = job.max_attempts ?? DEFAULT_MAX_ATTEMPTS;

  // `attempts` on the row is the count BEFORE this attempt; the RPC
  // increments it. The retry decision needs the post-increment number.
  const decision = decideRetry({
    kind: publishError.kind,
    attempt: job.attempts + 1,
    maxAttempts,
    providerRetryAfter: publishError.retryAfterSeconds,
  });

  const outcome: JobOutcome['outcome'] = decision.shouldRetry
    ? 'retryable_failure'
    : publishError.kind === 'needs_reconnect'
      ? 'needs_reconnect'
      : 'permanent_failure';

  // A broken credential is recorded against the account so the connections
  // screen can prompt a reconnect, rather than the user only ever seeing a
  // failed post.
  if (publishError.kind === 'needs_reconnect') {
    const accountId = await accountIdForJob(job, db);
    if (accountId) await recordAccountError(accountId, publishError, db);
  }

  await complete(job, db, {
    outcome,
    errorKind: publishError.kind,
    errorCode: publishError.code,
    errorMessage: publishError.message,
    providerResponse: publishError.providerResponse,
    retryDelaySeconds: decision.shouldRetry ? decision.delaySeconds : undefined,
    durationMs,
  });

  // Split explicitly rather than indexing into the logger: `logger.warn` takes
  // no error argument, so a computed level cannot share one call signature.
  const context = {
    jobId: job.id,
    platform: job.platform,
    kind: publishError.kind,
    code: publishError.code,
    attempt: job.attempts + 1,
    willRetry: decision.shouldRetry,
    reason: decision.reason,
  };

  if (publishError.kind === 'retryable') {
    logger.warn('publishing_worker:attempt_failed', { ...context, retryInSeconds: decision.delaySeconds });
  } else {
    logger.error('publishing_worker:attempt_failed', publishError, context);
  }

  return { outcome, errorKind: publishError.kind, errorCode: publishError.code };
}

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ */

interface PostRow {
  id: string;
  brand_id: string;
  status: string;
  caption: string | null;
  media_urls: unknown;
  external_post_id: string | null;
  external_url: string | null;
}

async function loadPost(job: PublishingJobRow, db: Db): Promise<PostRow> {
  const { data, error } = await db
    .from('social_posts')
    .select('id, brand_id, status, caption, media_urls, external_post_id, external_url')
    .eq('id', job.social_post_id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    // The post was deleted. The job can never succeed.
    throw new PublishError('permanent', 'post_missing', 'The post this job refers to no longer exists.');
  }

  return data as PostRow;
}

async function resolveAccount(brandId: string, platform: SocialPlatform, db: Db): Promise<SocialAccountRow> {
  const account = await accountForBrandPlatform(brandId, platform, db);

  if (!account) {
    throw new PublishError(
      'needs_reconnect',
      'no_connected_account',
      `No ${platform} account is connected for this brand. Connect one to publish.`
    );
  }

  const health = accountHealth(account);
  if (!health.usable) {
    throw new PublishError(
      'needs_reconnect',
      `account_${health.status}`,
      health.missingScopes.length > 0
        ? `The connected ${platform} account is missing permission(s): ${health.missingScopes.join(', ')}. Reconnect it.`
        : `The connected ${platform} account needs to be reconnected.`
    );
  }

  return account;
}

async function accountIdForJob(job: PublishingJobRow, db: Db): Promise<string | null> {
  if (!job.brand_id || !isSocialPlatform(job.platform)) return null;
  const account = await accountForBrandPlatform(job.brand_id, job.platform, db);
  return account?.id ?? null;
}

async function markPublishing(jobId: string, postId: string, db: Db): Promise<void> {
  await db.from('publishing_jobs').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', jobId);
  await db.from('social_posts').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', postId);
}

/**
 * Writes the terminal (or retry) state.
 *
 * Everything goes through the RPC so the job row, the attempt log and the
 * user-visible post move together. A worker that crashed between separate
 * writes would otherwise leave a failed post with no recorded reason.
 */
async function complete(
  job: PublishingJobRow,
  db: Db,
  input: {
    outcome: JobOutcome['outcome'];
    externalPostId?: string | null;
    externalUrl?: string | null;
    errorKind?: string;
    errorCode?: string;
    errorMessage?: string;
    providerResponse?: Record<string, unknown>;
    retryDelaySeconds?: number;
    durationMs?: number;
  }
): Promise<void> {
  const { error } = await db.rpc('complete_publishing_job', {
    p_job_id: job.id,
    p_outcome: input.outcome,
    p_external_post_id: input.externalPostId ?? null,
    p_external_url: input.externalUrl ?? null,
    p_error_kind: input.errorKind ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ? input.errorMessage.slice(0, 1000) : null,
    p_provider_response: input.providerResponse ?? null,
    p_duration_ms: input.durationMs ?? null,
    p_retry_delay_seconds: input.retryDelaySeconds ?? null,
  });

  if (error) {
    // The lease will expire and the job will be retried. Losing the outcome
    // record is bad, but silently swallowing it would be worse.
    logger.error('publishing_worker:complete_failed', error, { jobId: job.id, outcome: input.outcome });
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Media helpers
 * ------------------------------------------------------------------ */

function normalizeMediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Guesses whether the post is a video from the URL.
 *
 * Crude, and deliberately so: the alternative is a HEAD request per media item
 * from inside the worker, which adds a failure mode for no benefit — the
 * Instagram container API rejects a mismatched media type, and that rejection
 * is already classified as permanent with the platform's own message.
 */
function looksLikeVideo(value: unknown): boolean {
  const urls = normalizeMediaUrls(value);
  return urls.some((url) => /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url));
}
