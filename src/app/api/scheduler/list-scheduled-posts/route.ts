import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseSearchParams, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, accessibleBrandIds } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { PLATFORMS, type SocialPlatform } from '@/lib/social/platforms';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * The publishing queue, as the user sees it.
 *
 * Now reads `social_posts` — the table the worker actually publishes from —
 * rather than the orphaned `scheduled_posts`. It also returns the real
 * failure state: attempts used, the provider's error, and when the next retry
 * is due. Before, a post that had failed five times looked identical to one
 * still waiting.
 *
 * Scoped by brand rather than by `user_id`, so a workspace member sees their
 * team's calendar instead of only posts they personally created.
 */

const Query = z.object({
  brandId: uuidSchema.optional(),
  status: z.enum(['all', 'upcoming', 'published', 'failed']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const GET = routeHandler('/api/scheduler/list-scheduled-posts', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const query = parseSearchParams(request, Query);
  const db = supabaseAdmin();

  const brandIds = query.brandId
    ? [(await assertBrandAccess(user.id, query.brandId, { db })).id]
    : await accessibleBrandIds(user.id, db);

  if (brandIds.length === 0) {
    return NextResponse.json({ posts: [], counts: { upcoming: 0, published: 0, failed: 0 } });
  }

  let builder = db
    .from('social_posts')
    .select(
      'id, brand_id, platform, status, caption, media_urls, scheduled_for, published_at, external_post_id, external_url, last_error, content_asset_id, created_at'
    )
    .in('brand_id', brandIds);

  if (query.status === 'upcoming') {
    builder = builder.in('status', ['draft', 'awaiting_approval', 'scheduled', 'queued', 'publishing']);
  } else if (query.status === 'published') {
    builder = builder.eq('status', 'published');
  } else if (query.status === 'failed') {
    builder = builder.in('status', ['failed', 'cancelled']);
  }

  const { data: posts, error } = await builder
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .limit(query.limit);

  if (error) throw error;

  const rows = (posts ?? []) as Array<Record<string, any>>;

  // Job state, joined in one query rather than N. A post with no job row is
  // reported as such instead of silently looking scheduled.
  const jobsByPost = await loadJobs(rows.map((row) => row.id), db);

  const items = rows.map((row) => {
    const job = jobsByPost.get(row.id);
    return {
      id: row.id,
      brandId: row.brand_id,
      platform: row.platform,
      platformLabel: PLATFORMS[row.platform as SocialPlatform]?.label ?? row.platform,
      status: row.status,
      caption: row.caption,
      mediaUrls: Array.isArray(row.media_urls) ? row.media_urls : [],
      scheduledFor: row.scheduled_for,
      publishedAt: row.published_at,
      externalUrl: row.external_url,
      externalPostId: row.external_post_id,
      lastError: row.last_error,
      contentAssetId: row.content_asset_id,
      createdAt: row.created_at,
      job: job
        ? {
            id: job.id,
            status: job.status,
            attempts: job.attempts,
            maxAttempts: job.max_attempts,
            nextAttemptAt: job.next_attempt_at,
            errorCode: job.error_code,
            errorMessage: job.error_message,
          }
        : null,
      // An honest flag: no job means nothing will publish this.
      willPublish: Boolean(job) && !['published', 'failed', 'cancelled'].includes(row.status),
    };
  });

  const { data: counts } = await db
    .from('social_posts')
    .select('status')
    .in('brand_id', brandIds)
    .limit(1000);

  const statuses = ((counts ?? []) as Array<{ status: string }>).map((row) => row.status);

  return NextResponse.json({
    posts: items,
    counts: {
      upcoming: statuses.filter((s) => ['scheduled', 'queued', 'publishing', 'draft', 'awaiting_approval'].includes(s)).length,
      published: statuses.filter((s) => s === 'published').length,
      failed: statuses.filter((s) => s === 'failed' || s === 'cancelled').length,
    },
  });
});

async function loadJobs(postIds: string[], db: ReturnType<typeof supabaseAdmin>) {
  const map = new Map<string, Record<string, any>>();
  if (postIds.length === 0) return map;

  const { data } = await db
    .from('publishing_jobs')
    .select('id, social_post_id, status, attempts, max_attempts, next_attempt_at, error_code, error_message')
    .in('social_post_id', postIds);

  for (const job of (data ?? []) as Array<Record<string, any>>) {
    map.set(job.social_post_id, job);
  }

  return map;
}
