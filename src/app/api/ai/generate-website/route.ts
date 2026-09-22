import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { generateStructured } from '@/lib/ai/generate';
import { getCurrentBrandBrain } from '@/lib/brand/store';
import { buildBrandContext, buildFactualityInstructions } from '@/lib/brand/guard';
import { approvedFactsForBrand } from '@/lib/brand/product-facts';
import { generatedSiteSchema, generatedSiteJsonSchema } from '@/lib/website/schema';
import { saveGeneratedSite } from '@/lib/website/store';
import { reserveCredits, refundCredits } from '@/lib/credits';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';

export const dynamic = 'force-dynamic';

/**
 * Generate a website from the Brand Brain.
 *
 * PHASE 2 REWRITE. The previous version generated JSON and then threw it away —
 * nothing was persisted, so the "live preview" was a `<pre>` of raw JSON, there
 * was nothing for an editor to edit, and the ZIP export shipped a README and an
 * empty package.json because it had no source to stitch together.
 *
 * Now the structure is schema-validated and written to site_pages /
 * site_sections, with a revision snapshot so the generation can be undone.
 */

const Body = z.object({
  brandId: uuidSchema,
  /** landing | full | store … steers how many pages are produced. */
  siteType: z.enum(['landing', 'multi_page', 'store']).default('landing'),
  /** Extra direction from the user, on top of the Brand Brain. */
  instruction: boundedText(0, 1500).optional(),
});

const SYSTEM_ROLE = [
  'You are OwBrand’s website architect. You produce the structure and copy for a',
  'marketing site that expresses this brand.',
  '',
  'Return a single JSON object matching the requested shape. No markdown fence.',
  '',
  'Rules for structure:',
  '- Exactly one page has isHome true.',
  '- Every page opens with a hero and closes with a cta or footer.',
  '- Slugs are lowercase words separated by hyphens.',
  '- Write real copy, not lorem ipsum and not placeholder brackets.',
  '',
  'TESTIMONIALS: never write a customer quote. Emit the testimonials section with',
  '`placeholder: true` and the number of slots you would fill. A fabricated quote',
  'that reads as real is the single worst thing you could put on this site.',
  '',
  'PRICING: only include a pricing section if prices appear in the approved facts.',
  'If they do not, omit the section entirely rather than inventing tiers.',
].join('\n');

export const POST = routeHandler('/api/ai/generate-website', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('aiGeneration', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  const brand = await assertBrandAccess(user.id, body.brandId, { db, columns: 'name,description' });
  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));

  const brain = await getCurrentBrandBrain(body.brandId, db);
  if (!brain) {
    throw ApiError.invalid(
      'Generate this brand’s Brand Brain first — the website is built from it.'
    );
  }

  const approvedFacts = await approvedFactsForBrand(body.brandId, db);

  const reservation = await reserveCredits(user, 'generate_website');
  if (!reservation.allowed) {
    throw ApiError.paymentRequired(reservation.reason ?? 'Not enough credits.');
  }

  try {
    const pageGuidance =
      body.siteType === 'landing'
        ? 'Produce exactly one page: a complete landing page.'
        : body.siteType === 'store'
          ? 'Produce a home page plus a products page, and a contact page.'
          : 'Produce a home page plus 2-4 supporting pages appropriate to this business.';

    const result = await generateStructured({
      task: 'website_generation',
      system: [
        SYSTEM_ROLE,
        '',
        '--- BRAND ---',
        buildBrandContext(brain),
        '',
        '--- CONSTRAINTS ---',
        buildFactualityInstructions({ brandBrain: brain, approvedFacts }),
      ].join('\n'),
      prompt: [
        pageGuidance,
        body.instruction ? `Additional direction: ${body.instruction}` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      schema: generatedSiteSchema,
      jsonSchema: { name: 'generated_site', schema: generatedSiteJsonSchema },
      context: {
        userId: user.id,
        workspaceId,
        brandId: body.brandId,
        creditsCharged: reservation.creditCost,
      },
    });

    const site = result.data;

    // Persisted — this is the difference from the previous version.
    const saved = await saveGeneratedSite({
      brandId: body.brandId,
      userId: user.id,
      site,
      source: 'ai_generated',
      db,
    });

    logger.info('website:generated', {
      userId: user.id,
      brandId: body.brandId,
      siteType: body.siteType,
      provider: result.provider,
      pages: saved.pages,
      sections: saved.sections,
      revision: saved.revision,
    });

    return NextResponse.json(
      {
        site,
        persisted: saved,
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
    await refundCredits(user.id, reservation.creditCost, 'website_generation_failed');
    throw error;
  }
});
