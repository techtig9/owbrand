import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText, supportedPublishPlatformSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { createPublishIdempotencyKey } from '@/lib/publishing/idempotency';
import { DatabasePublishingQueue } from '@/lib/publishing/queue';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * SECURITY FIX (Phase 1)
 *
 * Before: NO AUTHENTICATION. The route accepted brandId, mediaUrls and — worst
 * of all — `accessTokenRef` straight from an anonymous request body, then
 * reported `{ queued: true }` for a job the queue never persisted.
 *
 * Now:
 *   - authenticated, rate limited, and the brand is authorized against the
 *     caller's ownership or workspace membership;
 *   - the platform credential is NEVER named by the client — the worker
 *     resolves it from the brand's stored connection at publish time;
 *   - the job is durably persisted and deduplicated by idempotency key;
 *   - a connected account for the platform must exist before we accept work.
 */

const queue = new DatabasePublishingQueue();

const PublishRequest = z.object({
  brandId: uuidSchema,
  platform: supportedPublishPlatformSchema,
  // The post being published. Used to build the idempotency key.
  postId: uuidSchema,
  caption: boundedText(0, 2200).optional(),
  mediaUrls: z.array(z.string().url()).min(1).max(10),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
});

export const POST = routeHandler('/api/social/publish', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('publish', user.id);

  const body = await parseJsonBody(request, PublishRequest);
  const db = supabaseAdmin();

  const brand = await assertBrandAccess(user.id, body.brandId, { db });

  // Refuse to queue work we know cannot succeed: the brand must actually have
  // a connected account for this platform.
  const { data: account } = await db
    .from('social_accounts')
    .select('id')
    .eq('user_id', user.id)
    .eq('platform', body.platform)
    .maybeSingle();

  if (!account) {
    throw ApiError.invalid(`Connect a ${body.platform} account before publishing.`);
  }

  // A scheduled time must be in the future — otherwise the worker would treat
  // it as immediately due, which is almost never what the caller meant.
  if (body.scheduledFor && new Date(body.scheduledFor).getTime() <= Date.now()) {
    throw ApiError.invalid('Scheduled time must be in the future.');
  }

  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));
  if (!workspaceId) throw ApiError.notFound('No workspace available for this brand.');

  const idempotencyKey = createPublishIdempotencyKey(body.postId, body.platform, body.scheduledFor);

  const { jobId, socialPostId, deduplicated } = await queue.enqueue({
    workspaceId,
    brandId: body.brandId,
    userId: user.id,
    platform: body.platform,
    caption: body.caption,
    mediaUrls: body.mediaUrls,
    scheduledFor: body.scheduledFor,
    idempotencyKey,
  });

  return NextResponse.json(
    {
      queued: true,
      deduplicated,
      jobId,
      socialPostId,
      status: body.scheduledFor ? 'scheduled' : 'queued',
      // Be honest about what "queued" means today.
      note: 'The publishing worker is delivered in Phase 3; this job is persisted and will be claimed when it runs.',
    },
    { status: deduplicated ? 200 : 202 }
  );
});
