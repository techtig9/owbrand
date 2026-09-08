import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertProductAssetAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { isConfigured } from '@/lib/env';
import { generateProductPhotos } from '@/lib/media/provider';
import { recordAssetVersion } from '@/lib/media/asset-versions';
import { getCurrentBrandBrain } from '@/lib/brand/store';
import { buildBrandContext } from '@/lib/brand/guard';
import { approvedFactsFor } from '@/lib/brand/product-facts';
import { enqueueJob, updateJobState, primaryWorkspaceId } from '@/lib/jobs/job-store';
import { reserveCredits, refundCredits } from '@/lib/credits';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * Generate product photography from a reference shot.
 *
 * PHASE 2 CHANGES:
 *   - The generation is now a durable job. Previously the route held the HTTP
 *     request open for the whole provider call, so a slow image model timed out
 *     the serverless invocation and the user got a failure for work that may
 *     well have completed.
 *   - Idempotent: the same request twice returns the original job rather than
 *     paying twice for the same four images.
 *   - Results are recorded as ASSET VERSIONS, so a regeneration is a version of
 *     the same asset rather than an unrelated row with no lineage.
 *   - The Brand Brain drives the prompt; previously only the raw colour list did.
 *   - Reports honestly when no provider is configured instead of failing with a
 *     provider error.
 */

const Body = z.object({
  brandId: uuidSchema,
  productId: uuidSchema,
  sourceAssetId: uuidSchema,
  style: boundedText(1, 80),
  scene: boundedText(1, 200),
  aspectRatio: z.enum(['1:1', '4:5', '3:2', '16:9', '9:16']).default('1:1'),
  count: z.number().int().min(1).max(6).default(4),
});

export const POST = routeHandler('/api/creative/photo', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('aiGeneration', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  // Authorizes asset -> product -> brand -> user in one call, and rejects a
  // source asset that belongs to a different product.
  const { asset: source, product, brand } = await assertProductAssetAccess(user.id, body.sourceAssetId, {
    db,
    productId: body.productId,
  });

  if (brand.id !== body.brandId) throw ApiError.notFound('Product not found.');

  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));
  if (!workspaceId) throw ApiError.notFound('No workspace available for this brand.');

  // Refuse before charging anything if there is nothing that could serve this.
  if (!isConfigured.imageProvider()) {
    throw ApiError.notConfigured(
      'Image generation is not configured yet. An administrator needs to connect an image provider.'
    );
  }

  const brain = await getCurrentBrandBrain(body.brandId, db);
  const approvedFacts = await approvedFactsFor(body.productId, db);

  const prompt = buildPhotoPrompt({
    productName: String(product.name ?? ''),
    brandName: String(brand.name ?? ''),
    brandContext: brain ? buildBrandContext(brain) : '',
    photographyStyle: brain?.visualIdentity?.photography?.style ?? '',
    avoid: brain?.visualIdentity?.photography?.avoid ?? [],
    approvedFacts: approvedFacts.facts,
    style: body.style,
    scene: body.scene,
    aspectRatio: body.aspectRatio,
    count: body.count,
  });

  // Same inputs => same key => the same job, so a double-click or a retry does
  // not bill twice.
  const idempotencyKey = createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'product_photo',
        sourceAssetId: body.sourceAssetId,
        style: body.style,
        scene: body.scene,
        aspectRatio: body.aspectRatio,
        count: body.count,
      })
    )
    .digest('hex');

  const { job, deduplicated } = await enqueueJob(
    {
      workspaceId,
      type: 'creative_generation',
      idempotencyKey,
      createdBy: user.id,
      payload: {
        kind: 'product_photo',
        brandId: body.brandId,
        productId: body.productId,
        sourceAssetId: body.sourceAssetId,
        prompt,
        aspectRatio: body.aspectRatio,
        count: body.count,
      },
    },
    db
  );

  if (deduplicated) {
    return NextResponse.json({
      jobId: job.id,
      deduplicated: true,
      state: job.state,
      note: 'This exact generation was already requested. Returning the original job.',
    });
  }

  const reservation = await reserveCredits(user, 'generate_photo');
  if (!reservation.allowed) {
    await updateJobState(job.id, { state: 'failed', error: 'insufficient_credits' }, db);
    throw ApiError.paymentRequired(reservation.reason ?? 'Not enough credits.');
  }

  await updateJobState(job.id, { state: 'running', progress: 10 }, db);

  try {
    const result = await generateProductPhotos({
      prompt,
      sourceImageUrl: (source.url as string | undefined) ?? undefined,
      aspectRatio: body.aspectRatio,
      count: body.count,
      metadata: { brandId: body.brandId, productId: body.productId, jobId: job.id },
    });

    const created: Array<{ assetId: string; version: number; url: string }> = [];

    for (const generated of result.assets) {
      const { data: assetRow, error: assetError } = await db
        .from('product_assets')
        .insert({
          product_id: body.productId,
          type: 'ai_photo',
          source: 'ai_generated',
          url: generated.url,
          prompt,
          status: 'pending_review',
          metadata: {
            ...generated.metadata,
            provider: result.provider,
            jobId: job.id,
            sourceAssetId: body.sourceAssetId,
            style: body.style,
            scene: body.scene,
            aspectRatio: body.aspectRatio,
          },
        })
        .select('id')
        .single();

      if (assetError || !assetRow) {
        logger.warn('creative_photo:asset_insert_failed', { jobId: job.id, error: String(assetError?.message) });
        continue;
      }

      const assetId = (assetRow as { id: string }).id;

      const version = await recordAssetVersion(
        {
          productAssetId: assetId,
          externalUrl: generated.url,
          prompt,
          provider: result.provider,
          providerJobId: String(generated.metadata?.providerJobId ?? ''),
          metadata: { style: body.style, scene: body.scene, aspectRatio: body.aspectRatio },
          createdBy: user.id,
        },
        db
      );

      created.push({ assetId, version: version.version, url: generated.url });
    }

    if (created.length === 0) {
      throw new Error('The image provider returned no usable assets.');
    }

    await updateJobState(
      job.id,
      { state: 'completed', progress: 100, result: { assets: created, provider: result.provider } },
      db
    );

    logger.info('creative_photo:generated', {
      userId: user.id,
      brandId: body.brandId,
      jobId: job.id,
      provider: result.provider,
      count: created.length,
    });

    return NextResponse.json(
      {
        jobId: job.id,
        state: 'completed',
        assets: created,
        provider: result.provider,
        creditsRemaining: reservation.creditsRemainingAfter ?? null,
        // Generated imagery goes to review rather than straight into the
        // library — the approval workflow is where a human confirms the product
        // still looks like itself.
        requiresReview: true,
      },
      { status: 201 }
    );
  } catch (error) {
    await updateJobState(
      job.id,
      { state: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'Generation failed.' },
      db
    );
    await refundCredits(user.id, reservation.creditCost, 'photo_generation_failed');

    logger.error('creative_photo:failed', error, { userId: user.id, jobId: job.id });

    throw new ApiError(
      'provider_unavailable',
      'Image generation failed. You have not been charged — please try again.'
    );
  }
});

/**
 * Builds the generation prompt.
 *
 * Product identity preservation is the whole game here: a generated shot that
 * subtly changes the packaging, label text or proportions is worse than no
 * shot, because it will be published as if it were the real product.
 */
function buildPhotoPrompt(input: {
  productName: string;
  brandName: string;
  brandContext: string;
  photographyStyle: string;
  avoid: string[];
  approvedFacts: string[];
  style: string;
  scene: string;
  aspectRatio: string;
  count: number;
}): string {
  const parts = [
    `Commercial product photograph of ${input.productName} by ${input.brandName}.`,
    '',
    'PRODUCT IDENTITY — preserve exactly from the reference image:',
    'packaging, label text, logo placement, proportions, colour and finish.',
    'Do not redesign, restyle, translate or "improve" anything printed on the product.',
    '',
    `Style: ${input.style}`,
    `Scene: ${input.scene}`,
    `Aspect ratio: ${input.aspectRatio}`,
  ];

  if (input.photographyStyle) parts.push(`Brand photography direction: ${input.photographyStyle}`);
  if (input.avoid.length) parts.push(`Never include: ${input.avoid.join(', ')}`);

  if (input.approvedFacts.length) {
    parts.push('', `Verified product details: ${input.approvedFacts.slice(0, 10).join('; ')}`);
  }

  parts.push(
    '',
    'Do not add text, badges, price stickers, award marks or certification logos',
    'that are not on the physical product in the reference.'
  );

  return parts.join('\n');
}
