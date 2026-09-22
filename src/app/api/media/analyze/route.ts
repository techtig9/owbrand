import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertProductAssetAccess, assertStoragePathOwnership } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { generateStructured } from '@/lib/ai/generate';
import {
  productVisionSchema,
  productVisionJsonSchema,
  productVisionUserPrompt,
} from '@/lib/prompts/creative';
import { productVisionSystemPrompt } from '@/lib/prompts/brand-brain';
import { proposeExtractedFacts } from '@/lib/brand/product-facts';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';
import type { AIImageInput } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';

/**
 * Analyse an uploaded product photo.
 *
 * PHASE 2 GAP CLOSED. This was the second route still calling lib/gemini.ts
 * directly — no timeout, no retry, no failover, no schema validation, no cost
 * logging. It also stored whatever the model returned straight onto the asset,
 * falling back to the RAW TEXT when JSON.parse failed, so a malformed response
 * became the asset's "analysis".
 *
 * The important product change: extracted facts now land in the Product Brain
 * as UNVERIFIED suggestions. Previously the analysis was a blob nothing could
 * act on; now it feeds the approved-fact store, but only after a human
 * confirms each item.
 */

/** Providers reject an oversized inline image; 8 MB base64 is a safe ceiling. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

const Body = z.object({
  assetId: uuidSchema,
  /** Also store the model's suggestions as unverified product facts. */
  extractFacts: z.boolean().default(true),
});

export const POST = routeHandler('/api/media/analyze', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('aiGeneration', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  // One guard authorizes the whole chain: asset -> product -> brand -> user.
  const { asset, product, brand } = await assertProductAssetAccess(user.id, body.assetId, { db });
  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));

  const storagePath = String(asset.url ?? '');
  if (!storagePath) throw ApiError.invalid('That asset has no stored file to analyse.');

  // The path must belong to this user before we read it, even though we already
  // authorized the asset row — defence in depth against a mismatched record.
  assertStoragePathOwnership(user.id, storagePath);

  const { data: file, error: downloadError } = await db.storage.from('owbrand-media').download(storagePath);
  if (downloadError || !file) {
    logger.warn('media_analyze:download_failed', { assetId: body.assetId, error: String(downloadError?.message) });
    throw ApiError.invalid('We could not read that uploaded image. Try re-uploading it.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw ApiError.invalid('That image is too large to analyse. Upload one under 8 MB.');
  }

  const mediaType = resolveMediaType(asset.metadata, file.type);
  if (!mediaType) {
    throw ApiError.invalid('That file type cannot be analysed. Use a JPEG, PNG, WebP or GIF.');
  }

  const image: AIImageInput = {
    base64: Buffer.from(bytes).toString('base64'),
    mediaType,
  };

  // Vision analysis is free: it exists to make the Product Brain usable, and
  // charging for it would discourage exactly the step that makes every later
  // generation factually safe.
  const result = await generateStructured({
    task: 'product_image_analysis',
    system: productVisionSystemPrompt(),
    prompt: productVisionUserPrompt({
      brandName: String(brand.name ?? ''),
      productName: String(product.name ?? ''),
      productDescription: (product.description as string | undefined) ?? undefined,
    }),
    images: [image],
    schema: productVisionSchema,
    jsonSchema: { name: 'product_vision', schema: productVisionJsonSchema },
    context: { userId: user.id, workspaceId, brandId: brand.id, creditsCharged: 0 },
  });

  const analysis = result.data;

  const { data: updated, error: updateError } = await db
    .from('product_assets')
    .update({ analysis, status: 'analyzed' })
    .eq('id', body.assetId)
    .select('id, type, status, analysis')
    .single();

  if (updateError) throw updateError;

  // Store candidate facts UNVERIFIED. Low-confidence items are dropped rather
  // than added as noise a human has to wade through.
  let proposedFacts = 0;
  if (body.extractFacts && analysis.extractedFacts.length > 0) {
    const worthProposing = analysis.extractedFacts.filter((f) => f.confidence !== 'low');

    if (worthProposing.length > 0) {
      try {
        proposedFacts = await proposeExtractedFacts({
          productId: String(product.id),
          facts: worthProposing.map((f) => ({
            fact: f.fact,
            category: f.category,
            numericValue: f.numericValue,
            unit: f.unit,
          })),
          db,
        });
      } catch (error) {
        // A failed fact write must not fail the analysis the user just paid
        // for in latency.
        logger.warn('media_analyze:fact_proposal_failed', { productId: product.id, error: String(error) });
      }
    }
  }

  logger.info('media_analyze:complete', {
    userId: user.id,
    assetId: body.assetId,
    provider: result.provider,
    productDetected: analysis.productDetected,
    proposedFacts,
  });

  return NextResponse.json({
    asset: updated,
    analysis,
    proposedFacts,
    // Be explicit that these are suggestions, not facts.
    note:
      proposedFacts > 0
        ? `${proposedFacts} suggested fact(s) added for your review. Nothing will quote them until you confirm each one.`
        : 'No facts were confident enough to suggest.',
    generation: {
      provider: result.provider,
      model: result.model,
      attempts: result.attempts,
      viaFallback: result.viaFallback ?? false,
    },
  });
});

/**
 * Resolves the image media type, preferring the value recorded at upload
 * (which we validated then) over the storage layer's guess.
 */
function resolveMediaType(metadata: unknown, fallback: string | undefined): AIImageInput['mediaType'] | null {
  const recorded = (metadata as { contentType?: string } | null)?.contentType;

  for (const candidate of [recorded, fallback]) {
    const normalized = candidate?.toLowerCase().split(';')[0]?.trim();
    if (normalized === 'image/jpg') return 'image/jpeg';
    if (normalized && (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(normalized)) {
      return normalized as AIImageInput['mediaType'];
    }
  }

  return null;
}
