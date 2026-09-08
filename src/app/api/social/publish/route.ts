import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, assertContentAssetAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { createPublishIdempotencyKey } from '@/lib/publishing/idempotency';
import { DatabasePublishingQueue, PublishNotPossibleError } from '@/lib/publishing/queue';
import { validateMediaForPlatform } from '@/lib/publishing/media-validation';
import { SOCIAL_PLATFORMS } from '@/lib/social/platforms';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';
import { isConfigured } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Queues a post for publishing.
 *
 * Phase 1 authenticated this route and made the queue durable. Phase 3 makes
 * the answer true: a queued post is now claimed by a real worker, published
 * through a real provider adapter, and retried on transient failure. The
 * "worker arrives in Phase 3" note is gone because the worker exists.
 *
 * `platform` accepts every platform rather than only the two we can publish
 * to, so an unsupported choice returns a specific explanation from the
 * platform table instead of a schema error that says nothing.
 */

const queue = new DatabasePublishingQueue();

const PublishRequest = z.object({
  brandId: uuidSchema,
  platform: z.enum(SOCIAL_PLATFORMS),
  /** The post identity. Used to build the idempotency key. */
  postId: uuidSchema,
  /** The generated asset this came from, so the post links back to it. */
  contentAssetId: uuidSchema.optional(),
  caption: boundedText(0, 63206).optional(),
  mediaUrls: z.array(z.string().url()).max(10).default([]),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
});

export const POST = routeHandler('/api/social/publish', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('publish', user.id);

  const body = await parseJsonBody(request, PublishRequest);
  const db = supabaseAdmin();

  const brand = await assertBrandAccess(user.id, body.brandId, { db });

  // A post can only be built from an asset the caller owns. Without this a
  // caller could publish another tenant's generated content to their own
  // account — the same class of bug this route had before Phase 1.
  if (body.contentAssetId) {
    await assertContentAssetAccess(user.id, body.contentAssetId, db);
  }

  if (!isConfigured.publishingWorker()) {
    // Queuing into a queue nothing drains would be the old lie in a new place.
    throw ApiError.notConfigured(
      'The publishing worker is not configured on this server (CRON_SECRET is unset), so a queued post would never be sent.'
    );
  }

  // Structural media checks before anything is written. Per-file limits need
  // sizes the caller may not have; /api/social/media-check covers those.
  const mediaCheck = validateMediaForPlatform(
    body.platform,
    body.mediaUrls.map(() => ({})),
    { caption: body.caption }
  );

  if (mediaCheck.postIssues.length > 0) {
    throw ApiError.invalid(mediaCheck.postIssues[0].message, {
      issues: mediaCheck.postIssues.map((issue) => issue.code),
    });
  }

  if (body.scheduledFor && new Date(body.scheduledFor).getTime() <= Date.now()) {
    throw ApiError.invalid('Scheduled time must be in the future.');
  }

  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));
  if (!workspaceId) throw ApiError.notFound('No workspace available for this brand.');

  const idempotencyKey = createPublishIdempotencyKey(body.postId, body.platform, body.scheduledFor);

  try {
    const result = await queue.enqueue({
      workspaceId,
      brandId: body.brandId,
      userId: user.id,
      platform: body.platform,
      caption: body.caption,
      mediaUrls: body.mediaUrls,
      scheduledFor: body.scheduledFor,
      idempotencyKey,
      contentAssetId: body.contentAssetId ?? null,
    });

    return NextResponse.json(
      {
        queued: true,
        deduplicated: result.deduplicated,
        jobId: result.jobId,
        publishingJobId: result.publishingJobId,
        socialPostId: result.socialPostId,
        status: result.state,
        scheduledFor: result.scheduledFor,
      },
      { status: result.deduplicated ? 200 : 202 }
    );
  } catch (error) {
    // A platform we cannot publish to, or an account that needs reconnecting,
    // is the caller's situation to fix — not a server fault.
    if (error instanceof PublishNotPossibleError) {
      throw ApiError.invalid(error.message, { reason: error.reason });
    }
    throw error;
  }
});
