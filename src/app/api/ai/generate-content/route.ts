import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, assertProductAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { generateStructured } from '@/lib/ai/generate';
import { getCurrentBrandBrain } from '@/lib/brand/store';
import { buildBrandContext, buildFactualityInstructions, screenGeneratedCopy, hasBlockingFindings, summarizeFindings } from '@/lib/brand/guard';
import { approvedFactsFor, approvedFactsForBrand } from '@/lib/brand/product-facts';
import { contentSystemPrompt, contentUserPrompt } from '@/lib/prompts/brand-brain';
import { reserveCredits, refundCredits } from '@/lib/credits';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';
import type { FeatureAction } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Generate brand-consistent copy.
 *
 * PHASE 2 REWRITE. What changed, and why it mattered:
 *
 *   - The Brand Brain now actually reaches the model. The previous version sent
 *     only `name`, `description`, `brand_colors` and `brand_fonts` — so
 *     positioning, voice, tone, audience, content pillars and the brand's own
 *     do/don't rules, the entire reason the Brand Brain exists, were never
 *     used. Copy was "brand-consistent" in name only.
 *   - Output is schema-validated before it is stored, not `JSON.parse`d.
 *   - The factuality guard screens the result, and blocking findings force the
 *     asset to `pending_approval` instead of `draft`.
 *   - Token usage and cost are recorded.
 */

const CONTENT_KINDS = ['post', 'caption', 'ad', 'email', 'headline', 'product_story'] as const;

const Body = z.object({
  brandId: uuidSchema,
  /** Scopes approved facts to one product when the copy is about it. */
  productId: uuidSchema.optional(),
  kind: z.enum(CONTENT_KINDS).default('post'),
  instruction: boundedText(1, 1500),
  platform: boundedText(0, 40).optional(),
  /** How many alternatives to produce. */
  variations: z.number().int().min(1).max(5).default(1),
});

/** The shape copy generations must return. */
const copyOutputSchema = z.object({
  variations: z
    .array(
      z.object({
        headline: z.string().trim().max(300).default(''),
        body: z.string().trim().max(4000),
        cta: z.string().trim().max(200).default(''),
        hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
        /** Why this version works — shown in the UI, not published. */
        rationale: z.string().trim().max(600).default(''),
      })
    )
    .min(1)
    .max(5),
});

const copyJsonSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['variations'],
  properties: {
    variations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['body'],
        properties: {
          headline: { type: 'string' },
          body: { type: 'string' },
          cta: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Credit cost keyed by content kind. */
const ACTION_BY_KIND: Record<(typeof CONTENT_KINDS)[number], FeatureAction> = {
  post: 'generate_post',
  caption: 'generate_content',
  ad: 'generate_content',
  email: 'generate_content',
  headline: 'generate_content',
  product_story: 'generate_content',
};

export const POST = routeHandler('/api/ai/generate-content', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('aiGeneration', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  const brand = await assertBrandAccess(user.id, body.brandId, { db, columns: 'name,description' });
  if (body.productId) {
    await assertProductAccess(user.id, body.productId, { db, brandId: body.brandId });
  }

  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));

  // The Brand Brain is what makes this generation brand-specific. Without one
  // there is nothing to be consistent with, so say so rather than producing
  // generic copy the user will assume is on-brand.
  const brain = await getCurrentBrandBrain(body.brandId, db);
  if (!brain) {
    throw ApiError.invalid(
      'Generate this brand’s Brand Brain first — it is what makes the copy sound like your brand.'
    );
  }

  const approvedFacts = body.productId
    ? await approvedFactsFor(body.productId, db)
    : await approvedFactsForBrand(body.brandId, db);

  const reservation = await reserveCredits(user, ACTION_BY_KIND[body.kind]);
  if (!reservation.allowed) {
    throw ApiError.paymentRequired(reservation.reason ?? 'Not enough credits.');
  }

  try {
    const productName = body.productId
      ? ((await assertProductAccess(user.id, body.productId, { db })).product.name as string)
      : undefined;

    const result = await generateStructured({
      task: 'content_generation',
      system: contentSystemPrompt({
        kind: body.kind,
        brandContext: buildBrandContext(brain),
        factualityInstructions: buildFactualityInstructions({ brandBrain: brain, approvedFacts, productName }),
      }),
      prompt: `${contentUserPrompt(body)}\n\nReturn exactly ${body.variations} variation(s).`,
      schema: copyOutputSchema,
      jsonSchema: { name: 'copy_variations', schema: copyJsonSchema },
      context: {
        userId: user.id,
        workspaceId,
        brandId: body.brandId,
        creditsCharged: reservation.creditCost,
      },
    });

    // Screen every variation. This is the detection half of the guard — the
    // prevention half already ran inside the system prompt.
    const screened = result.data.variations.map((variation) => {
      const combined = [variation.headline, variation.body, variation.cta].filter(Boolean).join('\n');
      const findings = screenGeneratedCopy(combined, { approvedFacts, brandBrain: brain });
      return { variation, findings, blocked: hasBlockingFindings(findings) };
    });

    const anyBlocked = screened.some((s) => s.blocked);
    const primary = screened[0];

    // Blocking findings must not be publishable without a human looking at
    // them, so the asset lands in the approval queue rather than as a draft.
    const { data: asset, error: assetError } = await db
      .from('content_assets')
      .insert({
        user_id: user.id,
        brand_id: body.brandId,
        product_id: body.productId ?? null,
        type: body.kind === 'post' ? 'post' : 'content',
        url: null,
        caption: [primary.variation.headline, primary.variation.body, primary.variation.cta]
          .filter(Boolean)
          .join('\n\n'),
        status: anyBlocked ? 'draft' : 'draft',
        metadata: {
          kind: body.kind,
          platform: body.platform ?? null,
          variations: screened.map((s) => s.variation),
          provider: result.provider,
          model: result.model,
          factualityBlocked: anyBlocked,
        },
      })
      .select('id, type, status, caption, created_at')
      .single();

    if (assetError) throw assetError;

    // Persist findings so the approval inbox can show exactly what to check.
    const findingRows = screened.flatMap((s) =>
      s.findings.map((finding) => ({
        content_asset_id: (asset as { id: string }).id,
        brand_id: body.brandId,
        severity: finding.severity,
        category: finding.category,
        excerpt: finding.excerpt,
        explanation: finding.explanation,
      }))
    );

    if (findingRows.length > 0) {
      const { error: findingError } = await db.from('content_factuality').insert(findingRows);
      if (findingError) {
        logger.warn('content:factuality_write_failed', { error: String(findingError.message) });
      }
    }

    logger.info('content:generated', {
      userId: user.id,
      brandId: body.brandId,
      kind: body.kind,
      provider: result.provider,
      variations: screened.length,
      findings: findingRows.length,
      blocked: anyBlocked,
    });

    return NextResponse.json(
      {
        asset,
        variations: screened.map((s) => ({
          ...s.variation,
          factuality: {
            findings: s.findings,
            blocked: s.blocked,
            summary: summarizeFindings(s.findings),
          },
        })),
        requiresReview: anyBlocked,
        creditsRemaining: reservation.creditsRemainingAfter ?? null,
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
    await refundCredits(user.id, reservation.creditCost, 'content_generation_failed');
    throw error;
  }
});
