import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { generateStructured } from '@/lib/ai/generate';
import { brandBrainSchema, brandBrainJsonSchema, DEFAULT_PROHIBITED_CLAIMS } from '@/lib/brand/schema';
import { saveBrandBrain } from '@/lib/brand/store';
import { brandBrainSystemPrompt, brandBrainUserPrompt } from '@/lib/prompts/brand-brain';
import { reserveCredits, refundCredits } from '@/lib/credits';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';

export const dynamic = 'force-dynamic';

/**
 * Build (or rebuild) a Brand Brain from a business description.
 *
 * PHASE 2 REWRITE. The previous version:
 *   - called Gemini directly with no timeout, retry or fallback;
 *   - did a bare `JSON.parse` on the output and spread the unvalidated result
 *     across five tables, so a renamed field silently produced an empty brand;
 *   - hard-coded a 250-credit cost while CREDIT_COSTS.build_brand said 500, and
 *     bypassed canUseFeature() with its own check-then-deduct;
 *   - overwrote the previous brand irrecoverably, with no version history;
 *   - recorded no token usage or cost.
 *
 * All of that now runs through lib/ai/generate.ts and lib/brand/store.ts.
 */

const Body = z.object({
  /** Omit to create a new brand; supply to regenerate an existing one. */
  brandId: uuidSchema.optional(),
  brandName: boundedText(1, 100),
  description: boundedText(20, 10_000),
  industry: boundedText(0, 100).optional(),
  location: boundedText(0, 120).optional(),
  targetMarkets: z.array(boundedText(1, 80)).max(10).optional(),
  goals: z.array(boundedText(1, 120)).max(10).optional(),
});

export const POST = routeHandler('/api/ai/build-brand', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('aiGeneration', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  // Regenerating an existing brand requires access to it.
  if (body.brandId) {
    await assertBrandAccess(user.id, body.brandId, { db });
  }

  const workspaceId = await primaryWorkspaceId(user.id, db);

  // Reserve credits BEFORE the provider call, refund on any failure.
  const reservation = await reserveCredits(user, 'build_brand');
  if (!reservation.allowed) {
    throw ApiError.paymentRequired(reservation.reason ?? 'Not enough credits.');
  }

  let brandId = body.brandId ?? null;

  try {
    const result = await generateStructured({
      task: 'brand_brain',
      system: brandBrainSystemPrompt(),
      prompt: brandBrainUserPrompt(body),
      schema: brandBrainSchema,
      jsonSchema: { name: 'brand_brain', schema: brandBrainJsonSchema },
      context: {
        userId: user.id,
        workspaceId,
        brandId,
        creditsCharged: reservation.creditCost,
      },
    });

    const brain = result.data;

    // The model's own name is advisory; the user's input wins.
    brain.name = body.brandName;

    // Baseline prohibitions apply to every brand, whatever the model returned.
    // Written defensively: the schema defaults these, but a section the model
    // omitted entirely must not throw here.
    brain.guidelines = {
      doRules: brain.guidelines?.doRules ?? [],
      dontRules: brain.guidelines?.dontRules ?? [],
      approvedClaims: brain.guidelines?.approvedClaims ?? [],
      complianceNotes: brain.guidelines?.complianceNotes ?? '',
      prohibitedClaims: Array.from(
        new Set([...DEFAULT_PROHIBITED_CLAIMS, ...(brain.guidelines?.prohibitedClaims ?? [])])
      ),
    };

    // Create the brand row only once we have a valid Brain to attach to it —
    // otherwise a failed generation would leave an empty brand behind.
    if (!brandId) {
      const { data: created, error } = await db
        .from('brands')
        .insert({
          user_id: user.id,
          workspace_id: workspaceId,
          name: body.brandName,
          description: body.description,
        })
        .select('id')
        .single();

      if (error || !created) throw error ?? new Error('Could not create the brand.');
      brandId = (created as { id: string }).id;
    }

    const version = await saveBrandBrain(
      {
        brandId,
        brain,
        source: 'ai_generated',
        createdBy: user.id,
        changeSummary: body.brandId ? 'Regenerated from the business description' : 'Initial generation',
      },
      db
    );

    logger.info('brand_brain:generated', {
      userId: user.id,
      brandId,
      version: version.version,
      provider: result.provider,
      model: result.model,
      attempts: result.attempts,
      viaFallback: result.viaFallback,
    });

    const { data: subscription } = await db
      .from('subscriptions')
      .select('credits_remaining')
      .eq('user_id', user.id)
      .maybeSingle();

    return NextResponse.json(
      {
        brandId,
        version: version.version,
        brain,
        creditsRemaining: (subscription as { credits_remaining?: number } | null)?.credits_remaining ?? null,
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
    // Failed generations cost the user nothing — the master command is explicit.
    await refundCredits(user.id, reservation.creditCost, 'brand_brain_generation_failed');
    throw error;
  }
});
