import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, assertContentAssetAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { generateStructured } from '@/lib/ai/generate';
import { getCurrentBrandBrain } from '@/lib/brand/store';
import { buildBrandContext, buildFactualityInstructions, screenGeneratedCopy, hasBlockingFindings } from '@/lib/brand/guard';
import { approvedFactsForBrand } from '@/lib/brand/product-facts';
import { reelScriptSchema, reelScriptJsonSchema, reelSystemRole, reelUserPrompt } from '@/lib/prompts/creative';
import { reserveCredits, refundCredits } from '@/lib/credits';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';

export const dynamic = 'force-dynamic';

/**
 * Plan a reel: hook, scenes, on-screen text, voiceover, caption.
 *
 * PHASE 2 GAP CLOSED. This route was still calling lib/gemini.ts directly, so
 * unlike every other AI route it had no timeout, no retry, no provider
 * failover, no schema validation (a bare `JSON.parse`), no factuality screen
 * and no cost logging. It also loaded only name/description/colours/fonts from
 * the brand, so the Brand Brain never reached the model.
 *
 * A voiceover asserting an unverified benefit is the same violation as writing
 * it in an ad, so the script is screened the same way copy is.
 */

const Body = z.object({
  brandId: uuidSchema,
  instruction: boundedText(1, 1500),
  /** Existing assets the reel should be built from. */
  assetIds: z.array(uuidSchema).max(12).default([]),
  durationSeconds: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(15),
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).default('9:16'),
});

export const POST = routeHandler('/api/ai/generate-reel', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('aiGeneration', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  const brand = await assertBrandAccess(user.id, body.brandId, { db, columns: 'name,description' });
  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));

  // Every asset is authorized individually — a caller must not be able to pair
  // their own brandId with someone else's asset ids.
  const assets: Array<{ index: number; caption: string | null; type?: string }> = [];
  for (const [index, assetId] of body.assetIds.entries()) {
    const asset = await assertContentAssetAccess(user.id, assetId, db);
    assets.push({
      index,
      caption: (asset.caption as string | null) ?? null,
      type: (asset.type as string | undefined) ?? undefined,
    });
  }

  const brain = await getCurrentBrandBrain(body.brandId, db);
  if (!brain) {
    throw ApiError.invalid('Generate this brand’s Brand Brain first — the reel script is written from it.');
  }

  const approvedFacts = await approvedFactsForBrand(body.brandId, db);

  const reservation = await reserveCredits(user, 'generate_reel');
  if (!reservation.allowed) {
    throw ApiError.paymentRequired(reservation.reason ?? 'Not enough credits.');
  }

  try {
    const result = await generateStructured({
      task: 'reel_script',
      system: [
        reelSystemRole(),
        '',
        '--- BRAND ---',
        buildBrandContext(brain),
        '',
        '--- CONSTRAINTS ---',
        buildFactualityInstructions({ brandBrain: brain, approvedFacts }),
      ].join('\n'),
      prompt: reelUserPrompt({
        instruction: body.instruction,
        durationSeconds: body.durationSeconds,
        aspectRatio: body.aspectRatio,
        assets,
      }),
      schema: reelScriptSchema,
      jsonSchema: { name: 'reel_script', schema: reelScriptJsonSchema },
      context: {
        userId: user.id,
        workspaceId,
        brandId: body.brandId,
        creditsCharged: reservation.creditCost,
      },
    });

    const script = result.data;

    // Screen everything a viewer would see or hear, not just the caption.
    const spokenAndVisible = [
      script.hook,
      script.caption,
      script.cta,
      ...script.scenes.flatMap((scene) => [scene.onScreenText, scene.voiceover]),
    ]
      .filter(Boolean)
      .join('\n');

    const findings = screenGeneratedCopy(spokenAndVisible, { approvedFacts, brandBrain: brain });
    const blocked = hasBlockingFindings(findings);

    const { data: asset, error: assetError } = await db
      .from('content_assets')
      .insert({
        user_id: user.id,
        brand_id: body.brandId,
        type: 'reel',
        url: null,
        caption: script.caption || null,
        status: 'draft',
        metadata: {
          script,
          durationSeconds: body.durationSeconds,
          aspectRatio: body.aspectRatio,
          sourceAssetIds: body.assetIds,
          provider: result.provider,
          model: result.model,
          factualityBlocked: blocked,
          // Honest: a plan is not a rendered video. The compositing worker is
          // Phase 3; nothing here has produced a file.
          renderState: 'not_rendered',
        },
      })
      .select('id, type, status, caption, created_at')
      .single();

    if (assetError) throw assetError;

    if (findings.length > 0) {
      const { error: findingError } = await db.from('content_factuality').insert(
        findings.map((finding) => ({
          content_asset_id: (asset as { id: string }).id,
          brand_id: body.brandId,
          severity: finding.severity,
          category: finding.category,
          excerpt: finding.excerpt,
          explanation: finding.explanation,
        }))
      );
      if (findingError) {
        logger.warn('reel:factuality_write_failed', { error: String(findingError.message) });
      }
    }

    logger.info('reel:scripted', {
      userId: user.id,
      brandId: body.brandId,
      provider: result.provider,
      scenes: script.scenes.length,
      findings: findings.length,
      blocked,
    });

    return NextResponse.json(
      {
        asset,
        script,
        factuality: { findings, blocked },
        requiresReview: blocked,
        creditsRemaining: reservation.creditsRemainingAfter ?? null,
        renderState: 'not_rendered',
        note: 'This is the shot plan. Video rendering is delivered in Phase 3.',
        generation: {
          provider: result.provider,
          model: result.model,
          attempts: result.attempts,
          viaFallback: result.viaFallback ?? false,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    await refundCredits(user.id, reservation.creditCost, 'reel_script_failed');
    throw error;
  }
});
