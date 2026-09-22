import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, assertContentAssetAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { canUseFeature } from '@/lib/credits';
import { createPublishIdempotencyKey } from '@/lib/publishing/idempotency';
import { DatabasePublishingQueue, PublishNotPossibleError } from '@/lib/publishing/queue';
import { validateMediaForPlatform } from '@/lib/publishing/media-validation';
import { SOCIAL_PLATFORMS } from '@/lib/social/platforms';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';
import { isConfigured } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Schedules a generated asset for publishing.
 *
 * Two defects fixed here, both serious:
 *
 * 1. IT SCHEDULED NOTHING. The route inserted into `scheduled_posts`, while
 *    the publishing worker reads `publishing_jobs`/`social_posts`. Two
 *    parallel systems existed and only one had a worker, so every post
 *    scheduled through this endpoint sat in a table nothing drained — while
 *    the response said `{ post }` as though it were booked. The comment
 *    admitted it ("Not implemented here") but the API did not.
 *
 * 2. CROSS-TENANT ASSET REFERENCE. `contentAssetId` was inserted with no
 *    ownership check. The row was scoped to `user_id`, so it read like it was
 *    safe — but a caller could name ANOTHER TENANT'S content asset, and once
 *    a worker existed it would fetch that asset and publish another business's
 *    creative to the caller's own social account. `assertContentAssetAccess`
 *    closes it.
 *
 * Scheduling remains free of credit cost — it reuses an already-generated
 * asset — but stays plan-gated.
 */

const queue = new DatabasePublishingQueue();

const Body = z.object({
  contentAssetId: uuidSchema,
  platform: z.enum(SOCIAL_PLATFORMS),
  scheduledAt: z.string().datetime({ offset: true }),
  /** Overrides the asset's own caption when the user edited it in the calendar. */
  caption: boundedText(0, 63206).optional(),
});

export const POST = routeHandler('/api/scheduler/schedule-post', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('publish', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  // Ownership first: everything below reads this asset's content.
  const asset = await assertContentAssetAccess(user.id, body.contentAssetId, db);
  const brandId = asset.brand_id as string;

  const brand = await assertBrandAccess(user.id, brandId, { db });

  const gate = await canUseFeature(user, 'schedule_post');
  if (!gate.allowed) throw ApiError.paymentRequired(gate.reason ?? 'Your plan does not include scheduling.');

  if (!isConfigured.publishingWorker()) {
    throw ApiError.notConfigured(
      'The publishing worker is not configured on this server (CRON_SECRET is unset), so a scheduled post would never be sent.'
    );
  }

  if (new Date(body.scheduledAt).getTime() <= Date.now()) {
    throw ApiError.invalid('Scheduled time must be in the future.');
  }

  const mediaUrls = mediaUrlsFor(asset);
  const caption = body.caption ?? (asset.caption as string | null) ?? undefined;

  const mediaCheck = validateMediaForPlatform(
    body.platform,
    mediaUrls.map(() => ({})),
    { caption }
  );

  if (mediaCheck.postIssues.length > 0) {
    throw ApiError.invalid(mediaCheck.postIssues[0].message, {
      issues: mediaCheck.postIssues.map((issue) => issue.code),
    });
  }

  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));
  if (!workspaceId) throw ApiError.notFound('No workspace available for this brand.');

  // Keyed on the asset, platform and slot: scheduling the same asset to the
  // same platform at the same time twice is one booking, not two posts.
  const idempotencyKey = createPublishIdempotencyKey(body.contentAssetId, body.platform, body.scheduledAt);

  try {
    const result = await queue.enqueue({
      workspaceId,
      brandId,
      userId: user.id,
      platform: body.platform,
      caption,
      mediaUrls,
      scheduledFor: body.scheduledAt,
      idempotencyKey,
      contentAssetId: body.contentAssetId,
    });

    return NextResponse.json(
      {
        scheduled: true,
        deduplicated: result.deduplicated,
        socialPostId: result.socialPostId,
        publishingJobId: result.publishingJobId,
        jobId: result.jobId,
        scheduledFor: result.scheduledFor,
        status: result.state,
      },
      { status: result.deduplicated ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof PublishNotPossibleError) {
      throw ApiError.invalid(error.message, { reason: error.reason });
    }
    throw error;
  }
});

/**
 * Extracts publishable media from a content asset.
 *
 * `content_assets.url` is the single-asset case; `metadata.mediaUrls` covers
 * a carousel produced by the creative pipeline. A text-only asset yields an
 * empty list, which the platform validator then accepts or rejects according
 * to whether that platform has a text-only post type.
 */
function mediaUrlsFor(asset: Record<string, unknown>): string[] {
  const urls: string[] = [];

  if (typeof asset.url === 'string' && asset.url.length > 0) urls.push(asset.url);

  const metadata = asset.metadata as { mediaUrls?: unknown } | null;
  if (Array.isArray(metadata?.mediaUrls)) {
    for (const candidate of metadata.mediaUrls) {
      if (typeof candidate === 'string' && candidate.length > 0 && !urls.includes(candidate)) {
        urls.push(candidate);
      }
    }
  }

  return urls.slice(0, 10);
}
