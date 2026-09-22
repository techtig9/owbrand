import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueJob, type JobRecord } from '@/lib/jobs/job-store';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accountForBrandPlatform, accountHealth } from '@/lib/social/account-store';
import { canPublishTo, PLATFORMS, type SocialPlatform } from '@/lib/social/platforms';
import { DEFAULT_MAX_ATTEMPTS } from './retry-policy';
import { logger } from '@/lib/logger';

/**
 * Durable publishing queue.
 *
 * Phase 1 replaced a version of this that returned
 * `{ jobId: 'publish_' + idempotencyKey.slice(0,16) }` and wrote nothing.
 * Phase 3 completes it: the rows it writes are now the rows the worker
 * actually claims, and it refuses work it can already tell will fail.
 *
 * Three rows, in dependency order:
 *   1. `social_posts`     — the user-visible post. Unique on idempotency_key.
 *   2. `publishing_jobs`  — what the worker leases and retries.
 *   3. `generation_jobs`  — the workspace-scoped job record the jobs API
 *                           exposes, so a client can poll one endpoint for
 *                           every kind of background work.
 *
 * The credential is conspicuously absent from the input type. The original
 * `PublishPayload` carried an `accessTokenRef` supplied by the client, which
 * the unauthenticated publish route passed straight through — so a caller
 * could name the credential to publish with. The worker resolves it from the
 * brand's stored connection instead, and nothing in between can influence
 * that choice.
 */

type Db = SupabaseClient<any, any, any>;

export interface EnqueuePublishInput {
  workspaceId: string;
  brandId: string;
  userId: string;
  platform: SocialPlatform;
  caption?: string;
  mediaUrls: string[];
  scheduledFor?: string;
  idempotencyKey: string;
  /** The generated asset this post came from, when there is one. */
  contentAssetId?: string | null;
}

export interface EnqueuePublishResult {
  jobId: string;
  publishingJobId: string;
  socialPostId: string;
  deduplicated: boolean;
  scheduledFor: string | null;
  /** What the caller should tell the user about when this will go out. */
  state: 'scheduled' | 'queued';
}

export class PublishNotPossibleError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'PublishNotPossibleError';
    this.reason = reason;
  }
}

export interface PublishingQueue {
  enqueue(payload: EnqueuePublishInput): Promise<EnqueuePublishResult>;
}

export class DatabasePublishingQueue implements PublishingQueue {
  async enqueue(payload: EnqueuePublishInput): Promise<EnqueuePublishResult> {
    const db = supabaseAdmin();

    await assertCanEnqueue(payload, db);

    const account = await accountForBrandPlatform(payload.brandId, payload.platform, db);
    const state: 'scheduled' | 'queued' = payload.scheduledFor ? 'scheduled' : 'queued';

    const { socialPostId, deduplicated: postDeduplicated } = await upsertPost(payload, account?.id ?? null, state, db);

    const publishingJobId = await upsertPublishingJob(payload, socialPostId, account?.id ?? null, state, db);

    const { job, deduplicated: jobDeduplicated } = await recordWorkspaceJob(payload, socialPostId, db);

    return {
      jobId: job.id,
      publishingJobId,
      socialPostId,
      deduplicated: postDeduplicated || jobDeduplicated,
      scheduledFor: payload.scheduledFor ?? null,
      state,
    };
  }
}

/**
 * Refuses work that cannot succeed, before anything is written.
 *
 * Accepting a TikTok post because the table has a `platform` column and then
 * failing it in the worker five attempts later is the behaviour the master
 * command's "never mark an unfinished integration as complete" rules out.
 */
async function assertCanEnqueue(payload: EnqueuePublishInput, db: Db): Promise<void> {
  const definition = PLATFORMS[payload.platform];

  if (!canPublishTo(payload.platform)) {
    throw new PublishNotPossibleError(
      'platform_unavailable',
      definition.unavailableReason ?? `OwBrand cannot publish to ${definition.label} yet.`
    );
  }

  const account = await accountForBrandPlatform(payload.brandId, payload.platform, db);

  if (!account) {
    throw new PublishNotPossibleError(
      'no_connected_account',
      `Connect a ${definition.label} account for this brand before publishing.`
    );
  }

  const health = accountHealth(account);
  if (!health.usable) {
    throw new PublishNotPossibleError(
      'account_needs_reconnect',
      health.missingScopes.length > 0
        ? `The connected ${definition.label} account is missing permission(s): ${health.missingScopes.join(', ')}. Reconnect it.`
        : `The connected ${definition.label} account needs to be reconnected before publishing.`
    );
  }
}

async function upsertPost(
  payload: EnqueuePublishInput,
  socialAccountId: string | null,
  state: 'scheduled' | 'queued',
  db: Db
): Promise<{ socialPostId: string; deduplicated: boolean }> {
  const row = {
    brand_id: payload.brandId,
    social_account_id: socialAccountId,
    content_asset_id: payload.contentAssetId ?? null,
    created_by: payload.userId,
    platform: payload.platform,
    status: state,
    caption: payload.caption ?? null,
    media_urls: payload.mediaUrls ?? [],
    scheduled_for: payload.scheduledFor ?? null,
    idempotency_key: payload.idempotencyKey,
  };

  const { data, error } = await db.from('social_posts').insert(row).select('id').single();

  if (!error && data) {
    return { socialPostId: (data as { id: string }).id, deduplicated: false };
  }

  // 23505 = unique_violation on idempotency_key. Return the original post
  // rather than creating a second one: a duplicated social post is publicly
  // visible and cannot be undone.
  if (error && (error as { code?: string }).code === '23505') {
    const { data: existing } = await db
      .from('social_posts')
      .select('id')
      .eq('idempotency_key', payload.idempotencyKey)
      .maybeSingle();

    if (existing) {
      logger.info('publishing:deduplicated_post', {
        brandId: payload.brandId,
        socialPostId: (existing as { id: string }).id,
        platform: payload.platform,
      });
      return { socialPostId: (existing as { id: string }).id, deduplicated: true };
    }
  }

  throw error ?? new Error('Could not persist the post.');
}

async function upsertPublishingJob(
  payload: EnqueuePublishInput,
  socialPostId: string,
  socialAccountId: string | null,
  state: 'scheduled' | 'queued',
  db: Db
): Promise<string> {
  const row = {
    social_post_id: socialPostId,
    brand_id: payload.brandId,
    social_account_id: socialAccountId,
    platform: payload.platform,
    status: state,
    idempotency_key: payload.idempotencyKey,
    scheduled_for: payload.scheduledFor ?? null,
    max_attempts: DEFAULT_MAX_ATTEMPTS,
    // A job with no schedule is due immediately.
    next_attempt_at: payload.scheduledFor ?? null,
  };

  const { data, error } = await db.from('publishing_jobs').insert(row).select('id').single();

  if (!error && data) return (data as { id: string }).id;

  if (error && (error as { code?: string }).code === '23505') {
    const { data: existing } = await db
      .from('publishing_jobs')
      .select('id')
      .eq('idempotency_key', payload.idempotencyKey)
      .maybeSingle();

    if (existing) return (existing as { id: string }).id;
  }

  // Without a publishing job nothing will ever publish this post, so the post
  // must not be left looking queued.
  await db
    .from('social_posts')
    .update({ status: 'failed', last_error: 'Could not queue the publishing job.' })
    .eq('id', socialPostId);

  throw error ?? new Error('Could not queue the publishing job.');
}

/**
 * The workspace-scoped job record.
 *
 * Best-effort by design: `publishing_jobs` is what the worker reads, so a
 * failure here costs the client a polling endpoint, not the publish. Failing
 * the whole request would be worse — the post is already queued and would
 * publish anyway.
 */
async function recordWorkspaceJob(
  payload: EnqueuePublishInput,
  socialPostId: string,
  db: Db
): Promise<{ job: JobRecord; deduplicated: boolean }> {
  const result = await enqueueJob(
    {
      workspaceId: payload.workspaceId,
      type: 'social_publish',
      idempotencyKey: payload.idempotencyKey,
      createdBy: payload.userId,
      payload: {
        socialPostId,
        brandId: payload.brandId,
        platform: payload.platform,
        scheduledFor: payload.scheduledFor ?? null,
        mediaCount: payload.mediaUrls?.length ?? 0,
      },
    },
    db
  );

  return result;
}
