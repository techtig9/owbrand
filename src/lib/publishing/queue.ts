import type { SocialPlatform } from './platform-types';
import { enqueueJob, type JobRecord } from '@/lib/jobs/job-store';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * Durable publishing queue.
 *
 * The previous DatabasePublishingQueue returned
 *   `{ jobId: 'publish_' + idempotencyKey.slice(0,16) }`
 * and wrote nothing to the database, so /api/social/publish reported success
 * for work that would never be performed and could never be inspected.
 *
 * This implementation writes two rows in the right order:
 *   1. `social_posts`  — the user-visible post, unique on idempotency_key
 *   2. `generation_jobs` — the durable work item the worker will claim
 *
 * Actually executing the job (OAuth token exchange, Graph API calls, retries)
 * is Phase 3. What Phase 1 fixes is the lie: an enqueued publish is now a real,
 * queryable, restart-surviving record, and a duplicate request returns the
 * original instead of creating a second post.
 */
/**
 * What the API layer may hand the queue.
 *
 * Note what is ABSENT: no access token and no token reference. The old
 * PublishPayload carried an `accessTokenRef` supplied by the client, which the
 * route passed straight through. Credentials are resolved server-side by the
 * worker from the brand's stored OAuth connection at publish time — a caller
 * never gets to name which credential is used.
 */
export interface EnqueuePublishInput {
  workspaceId: string;
  brandId: string;
  userId: string;
  platform: SocialPlatform;
  caption?: string;
  mediaUrls: string[];
  scheduledFor?: string;
  idempotencyKey: string;
}

export interface EnqueuePublishResult {
  jobId: string;
  socialPostId: string;
  deduplicated: boolean;
}

export interface PublishingQueue {
  enqueue(payload: EnqueuePublishInput): Promise<EnqueuePublishResult>;
}

export class DatabasePublishingQueue implements PublishingQueue {
  async enqueue(payload: EnqueuePublishInput): Promise<EnqueuePublishResult> {
    const db = supabaseAdmin();

    // 1. The post itself. The unique idempotency_key is what prevents the same
    //    content being published twice.
    const postRow = {
      brand_id: payload.brandId,
      platform: payload.platform,
      status: payload.scheduledFor ? 'scheduled' : 'queued',
      caption: payload.caption ?? null,
      media_urls: payload.mediaUrls ?? [],
      scheduled_for: payload.scheduledFor ?? null,
      idempotency_key: payload.idempotencyKey,
    };

    let socialPostId: string;
    let deduplicated = false;

    const { data: inserted, error: insertError } = await db
      .from('social_posts')
      .insert(postRow)
      .select('id')
      .single();

    if (insertError) {
      if ((insertError as { code?: string }).code === '23505') {
        const { data: existing } = await db
          .from('social_posts')
          .select('id')
          .eq('idempotency_key', payload.idempotencyKey)
          .maybeSingle();

        if (!existing) throw insertError;
        socialPostId = (existing as { id: string }).id;
        deduplicated = true;
        logger.info('publishing:deduplicated_post', {
          brandId: payload.brandId,
          socialPostId,
          platform: payload.platform,
        });
      } else {
        throw insertError;
      }
    } else {
      socialPostId = (inserted as { id: string }).id;
    }

    // 2. The durable work item. Same idempotency key, so a retry that got past
    //    step 1 still cannot create a second job.
    let job: JobRecord;
    try {
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
      job = result.job;
      deduplicated = deduplicated || result.deduplicated;
    } catch (error) {
      // The post exists but the work item does not — leave the post in a state
      // that clearly is not "queued for publishing".
      await db
        .from('social_posts')
        .update({ status: 'failed', last_error: 'Could not queue the publishing job.' })
        .eq('id', socialPostId);
      throw error;
    }

    // 3. Worker-facing bookkeeping row. Best-effort: the job above is the
    //    source of truth, this table exists for operational visibility.
    const { error: jobRowError } = await db.from('publishing_jobs').insert({
      social_post_id: socialPostId,
      platform: payload.platform,
      status: payload.scheduledFor ? 'scheduled' : 'queued',
      idempotency_key: payload.idempotencyKey,
      scheduled_for: payload.scheduledFor ?? null,
    });

    if (jobRowError && (jobRowError as { code?: string }).code !== '23505') {
      logger.warn('publishing:job_row_insert_failed', {
        socialPostId,
        error: String(jobRowError.message ?? jobRowError),
      });
    }

    return { jobId: job.id, socialPostId, deduplicated };
  }
}
