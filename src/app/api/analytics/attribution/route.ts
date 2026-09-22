import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, uuidSchema, boundedText } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import {
  attribute,
  attributeAllModels,
  modelDisagreement,
  ATTRIBUTION_MODELS,
  type TouchpointRecord,
} from '@/lib/analytics/attribution';
import { SOCIAL_PLATFORMS } from '@/lib/social/platforms';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Attribution.
 *
 * GET runs the requested model — or all three — over the brand's recorded
 * touchpoints. The previous version summed every touchpoint's revenue and
 * called the biggest sum the "top platform", which double counts any journey
 * with more than one touch.
 *
 * POST records a touchpoint. This is the only way conversions and revenue ever
 * enter the system: platform insights do not report them, so they come from
 * the tenant's own site or CRM. It is a write, so it is authorized, validated
 * and idempotent on the caller's own event id.
 */

const Query = z.object({
  brandId: uuidSchema,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  model: z.enum(['all', ...ATTRIBUTION_MODELS]).default('all'),
});

export const GET = routeHandler('/api/analytics/attribution', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const query = parseSearchParams(request, Query);
  const db = supabaseAdmin();
  await assertBrandAccess(user.id, query.brandId, { db });

  const to = query.to ?? new Date().toISOString().slice(0, 10);
  const from = query.from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await db
    .from('attribution_touchpoints')
    .select('platform, occurred_at, journey_key, clicks, conversions, revenue, spend, social_post_id, campaign_id')
    .eq('brand_id', query.brandId)
    .gte('occurred_at', `${from}T00:00:00Z`)
    .lte('occurred_at', `${to}T23:59:59Z`)
    .order('occurred_at', { ascending: true })
    .limit(20000);

  if (error) throw error;

  const touchpoints = (data ?? []) as TouchpointRecord[];

  if (query.model === 'all') {
    const results = attributeAllModels(touchpoints);
    return NextResponse.json({
      range: { from, to },
      models: results,
      // Where the models disagree is the actionable insight — last-touch
      // systematically under-credits discovery channels.
      disagreement: modelDisagreement(results),
      coverage: results.last_touch.coverage,
    });
  }

  const result = attribute(touchpoints, query.model);
  return NextResponse.json({ range: { from, to }, result, coverage: result.coverage });
});

const TouchpointBody = z.object({
  brandId: uuidSchema,
  platform: z.enum(SOCIAL_PLATFORMS),
  occurredAt: z.string().datetime({ offset: true }),
  /**
   * The caller's own id for this event. Required, and unique per brand, so a
   * retried webhook cannot record the same conversion twice — which would
   * inflate revenue and every ROAS figure derived from it.
   */
  externalEventId: boundedText(1, 200),
  /** Groups touches in one customer journey. Without it only last-touch works. */
  journeyKey: boundedText(0, 200).optional(),
  socialPostId: uuidSchema.optional(),
  campaignId: uuidSchema.optional(),
  clicks: z.number().int().min(0).max(1_000_000).default(0),
  conversions: z.number().int().min(0).max(1_000_000).default(0),
  revenue: z.number().finite().min(0).max(100_000_000).default(0),
  spend: z.number().finite().min(0).max(100_000_000).default(0),
  source: boundedText(0, 100).optional(),
  medium: boundedText(0, 100).optional(),
});

export const POST = routeHandler('/api/analytics/attribution', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, TouchpointBody);
  const db = supabaseAdmin();
  await assertBrandAccess(user.id, body.brandId, { db });

  // A touchpoint that names a campaign must name one belonging to this brand.
  if (body.campaignId) {
    const { data: campaign } = await db
      .from('campaigns')
      .select('id')
      .eq('id', body.campaignId)
      .eq('brand_id', body.brandId)
      .maybeSingle();

    if (!campaign) throw ApiError.notFound('Campaign not found for this brand.');
  }

  const { data, error } = await db
    .from('attribution_touchpoints')
    .insert({
      brand_id: body.brandId,
      platform: body.platform,
      external_event_id: body.externalEventId,
      journey_key: body.journeyKey || null,
      social_post_id: body.socialPostId ?? null,
      campaign_id: body.campaignId ?? null,
      occurred_at: body.occurredAt,
      clicks: body.clicks,
      conversions: body.conversions,
      revenue: body.revenue,
      spend: body.spend,
      source: body.source ?? null,
      medium: body.medium ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = unique_violation on (brand_id, external_event_id). A duplicate
    // is a successful no-op, not a failure: retrying a webhook must not
    // record the conversion twice.
    if ((error as { code?: string }).code === '23505') {
      const { data: existing } = await db
        .from('attribution_touchpoints')
        .select('id')
        .eq('brand_id', body.brandId)
        .eq('external_event_id', body.externalEventId)
        .maybeSingle();

      return NextResponse.json({
        recorded: true,
        deduplicated: true,
        touchpointId: (existing as { id: string } | null)?.id ?? null,
      });
    }
    throw error;
  }

  logger.info('attribution:touchpoint_recorded', {
    userId: user.id,
    brandId: body.brandId,
    platform: body.platform,
    hasJourney: Boolean(body.journeyKey),
  });

  return NextResponse.json(
    { recorded: true, deduplicated: false, touchpointId: (data as { id: string }).id },
    { status: 201 }
  );
});
