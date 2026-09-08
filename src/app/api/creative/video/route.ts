import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertProductAccess, assertProductAssetAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { isConfigured } from '@/lib/env';
import { submitProductVideo } from '@/lib/media/video-provider';
import { recordAssetVersion } from '@/lib/media/asset-versions';
import { getCurrentBrandBrain } from '@/lib/brand/store';
import { approvedFactsFor } from '@/lib/brand/product-facts';
import { enqueueJob, updateJobState, primaryWorkspaceId } from '@/lib/jobs/job-store';
import { reserveCredits, refundCredits } from '@/lib/credits';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * Submit a product video for generation.
 *
 * Video is inherently asynchronous — providers return a job id and finish
 * minutes later — so unlike the photo route this one never waits for a result.
 * It submits, records the provider's job id, and leaves the job `running` for
 * the completion worker (Phase 3) to finish.
 *
 * The previous version awaited the provider inside the request and wrote
 * `completed` whenever an outputUrl happened to be present, which meant a
 * still-rendering video was silently reported as done.
 */

const Body = z.object({
  brandId: uuidSchema,
  productId: uuidSchema,
  sourceAssetIds: z.array(uuidSchema).min(1).max(6),
  durationSeconds: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(15),
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).default('9:16'),
  style: boundedText(1, 100),
  goal: boundedText(1, 300),
});

export const POST = routeHandler('/api/creative/video', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('aiGeneration', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  const { product, brand } = await assertProductAccess(user.id, body.productId, { db, brandId: body.brandId });
  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));
  if (!workspaceId) throw ApiError.notFound('No workspace available for this brand.');

  // Every source asset authorized individually, and each must belong to this
  // product.
  const sourceUrls: string[] = [];
  for (const assetId of body.sourceAssetIds) {
    const { asset } = await assertProductAssetAccess(user.id, assetId, { db, productId: body.productId });
    const url = asset.url as string | null;
    if (url) sourceUrls.push(url);
  }

  if (sourceUrls.length === 0) {
    throw ApiError.invalid('None of those source assets have a stored file.');
  }

  if (!isConfigured.videoProvider()) {
    throw ApiError.notConfigured(
      'Video generation is not configured yet. An administrator needs to connect a video provider.'
    );
  }

  const brain = await getCurrentBrandBrain(body.brandId, db);
  const approvedFacts = await approvedFactsFor(body.productId, db);

  const prompt = [
    `A ${body.durationSeconds}-second ${body.aspectRatio} product video for ${brand.name}.`,
    `Product: ${product.name}.`,
    `Goal: ${body.goal}`,
    `Style: ${body.style}`,
    '',
    'PRODUCT IDENTITY — preserve exactly: packaging, label text, logo, proportions,',
    'colour and finish. Do not restyle anything printed on the product.',
    '',
    'Strong first-second hook, clean pacing, one clear call to action.',
    brain?.visualIdentity?.direction ? `Visual direction: ${brain.visualIdentity.direction}` : '',
    approvedFacts.facts.length
      ? `Verified product details: ${approvedFacts.facts.slice(0, 10).join('; ')}`
      : 'No verified product details exist — make no factual claim about the product.',
  ]
    .filter(Boolean)
    .join('\n');

  const idempotencyKey = createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'product_video',
        productId: body.productId,
        sourceAssetIds: [...body.sourceAssetIds].sort(),
        durationSeconds: body.durationSeconds,
        aspectRatio: body.aspectRatio,
        style: body.style,
        goal: body.goal,
      })
    )
    .digest('hex');

  const { job, deduplicated } = await enqueueJob(
    {
      workspaceId,
      type: 'video_generation',
      idempotencyKey,
      createdBy: user.id,
      payload: {
        kind: 'product_video',
        brandId: body.brandId,
        productId: body.productId,
        sourceAssetIds: body.sourceAssetIds,
        prompt,
        durationSeconds: body.durationSeconds,
        aspectRatio: body.aspectRatio,
      },
    },
    db
  );

  if (deduplicated) {
    return NextResponse.json({
      jobId: job.id,
      deduplicated: true,
      state: job.state,
      note: 'This exact video was already requested. Returning the original job.',
    });
  }

  const reservation = await reserveCredits(user, 'generate_video');
  if (!reservation.allowed) {
    await updateJobState(job.id, { state: 'failed', error: 'insufficient_credits' }, db);
    throw ApiError.paymentRequired(reservation.reason ?? 'Not enough credits.');
  }

  try {
    const submission = await submitProductVideo({
      prompt,
      sourceImageUrls: sourceUrls,
      durationSeconds: body.durationSeconds,
      aspectRatio: body.aspectRatio,
      metadata: { brandId: body.brandId, productId: body.productId, jobId: job.id },
    });

    // Only a provider that has ALREADY produced a file is complete. Anything
    // else stays running for the completion worker — reporting a rendering
    // video as done was the previous bug.
    const finished = Boolean(submission.outputUrl);

    if (finished) {
      const { data: assetRow } = await db
        .from('product_assets')
        .insert({
          product_id: body.productId,
          type: 'ai_video',
          source: 'ai_generated',
          url: submission.outputUrl,
          prompt,
          status: 'pending_review',
          metadata: {
            provider: submission.provider,
            providerJobId: submission.jobId,
            jobId: job.id,
            durationSeconds: body.durationSeconds,
            aspectRatio: body.aspectRatio,
            style: body.style,
          },
        })
        .select('id')
        .single();

      if (assetRow) {
        await recordAssetVersion(
          {
            productAssetId: (assetRow as { id: string }).id,
            externalUrl: submission.outputUrl ?? null,
            prompt,
            provider: submission.provider,
            providerJobId: submission.jobId,
            metadata: { durationSeconds: body.durationSeconds, aspectRatio: body.aspectRatio },
            createdBy: user.id,
          },
          db
        );
      }
    }

    await updateJobState(
      job.id,
      finished
        ? {
            state: 'completed',
            progress: 100,
            result: { outputUrl: submission.outputUrl, provider: submission.provider },
          }
        : {
            state: 'running',
            progress: 25,
            result: { providerJobId: submission.jobId, provider: submission.provider },
          },
      db
    );

    logger.info('creative_video:submitted', {
      userId: user.id,
      brandId: body.brandId,
      jobId: job.id,
      providerJobId: submission.jobId,
      finished,
    });

    return NextResponse.json(
      {
        jobId: job.id,
        providerJobId: submission.jobId,
        state: finished ? 'completed' : 'running',
        outputUrl: submission.outputUrl ?? null,
        creditsRemaining: reservation.creditsRemainingAfter ?? null,
        requiresReview: true,
        note: finished
          ? undefined
          : 'Rendering. Poll /api/jobs/create for status — the completion worker is delivered in Phase 3.',
      },
      { status: 202 }
    );
  } catch (error) {
    await updateJobState(
      job.id,
      { state: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'Submission failed.' },
      db
    );
    await refundCredits(user.id, reservation.creditCost, 'video_generation_failed');

    logger.error('creative_video:failed', error, { userId: user.id, jobId: job.id });

    throw new ApiError(
      'provider_unavailable',
      'Video generation could not be started. You have not been charged — please try again.'
    );
  }
});
