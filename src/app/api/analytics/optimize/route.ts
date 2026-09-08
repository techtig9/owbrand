import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import {
  summarize,
  sumTotals,
  previousRange,
  latestPerPost,
  type DailyMetricRecord,
  type PostMetricRecord,
} from '@/lib/analytics/metrics';
import { detectSignals, confidenceBand, MIN_CONFIDENCE_TO_REPORT } from '@/lib/analytics/signals';
import { attribute, type TouchpointRecord } from '@/lib/analytics/attribution';
import { generateRecommendations } from '@/lib/analytics/recommendations';
import { primaryWorkspaceId } from '@/lib/jobs/job-store';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Generates recommendations from the brand's stored analytics.
 *
 * The version this replaces summed daily rows into one snapshot and compared
 * it against hard-coded thresholds — so a 1.9% engagement rate produced the
 * same advice whether it came from 200 impressions or 200,000, and the answer
 * carried no confidence and cited no numbers.
 *
 * Now: signals are detected against the brand's OWN previous period, each
 * carries a derived confidence and the evidence it was computed from, anything
 * under the confidence floor is withheld, and the results are persisted so the
 * dashboard and the approval flow see the same rows.
 */

const Body = z.object({
  brandId: uuidSchema,
  days: z.number().int().min(7).max(365).default(30),
  /** Detect only — do not write recommendation rows. */
  dryRun: z.boolean().default(false),
});

export const POST = routeHandler('/api/analytics/optimize', async (request: Request) => {
  const user = await requireUser();
  // Generation may call the AI provider, so this shares the AI budget rather
  // than the cheap read budget.
  await enforceRateLimit('aiGeneration', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();
  const brand = await assertBrandAccess(user.id, body.brandId, { db });

  const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (body.days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const range = { from, to };

  const rows = await loadDaily(body.brandId, range, db);
  const summary = summarize(rows, range);

  const previous = previousRange(range);
  const previousRows = await loadDaily(body.brandId, previous, db);

  const posts = latestPerPost(await loadPosts(body.brandId, range, db));
  const attribution = await loadAttribution(body.brandId, range, db);

  const signals = detectSignals({
    windowDays: body.days,
    current: summary,
    previous: previousRows.length > 0 ? { totals: sumTotals(previousRows), hasData: true } : null,
    posts,
    attribution: attribution
      ? {
          unattributedRevenue: attribution.coverage.unattributedRevenue,
          attributedRevenue: attribution.totals.revenue,
          multiTouchJourneys: attribution.coverage.multiTouchJourneys,
        }
      : null,
  });

  const detected = signals.map((signal) => ({
    kind: signal.kind,
    priority: signal.priority,
    confidence: signal.confidence,
    confidenceBand: confidenceBand(signal.confidence),
    sampleSize: signal.sampleSize,
    evidence: signal.evidence,
    observation: signal.observation,
    actionType: signal.actionType,
  }));

  if (body.dryRun) {
    return NextResponse.json({
      range,
      signals: detected,
      coverage: summary.coverage,
      confidenceFloor: MIN_CONFIDENCE_TO_REPORT,
      persisted: false,
    });
  }

  const workspaceId = (brand.workspace_id as string | null) ?? (await primaryWorkspaceId(user.id, db));

  const { recommendations, narrativeUsed } = await generateRecommendations({
    brandId: body.brandId,
    workspaceId,
    windowDays: body.days,
    signals,
    db,
  });

  return NextResponse.json({
    range,
    signals: detected,
    recommendations,
    coverage: summary.coverage,
    confidenceFloor: MIN_CONFIDENCE_TO_REPORT,
    // Honest about how the text was produced: with no AI provider configured
    // the deterministic observation is what got stored.
    narrativeUsed,
    persisted: true,
  });
});

async function loadDaily(
  brandId: string,
  range: { from: string; to: string },
  db: ReturnType<typeof supabaseAdmin>
): Promise<DailyMetricRecord[]> {
  const { data, error } = await db
    .from('analytics_daily')
    .select(
      'metric_date, platform, reach, impressions, engagements, clicks, conversions, video_views, spend, revenue, raw_metrics'
    )
    .eq('brand_id', brandId)
    .gte('metric_date', range.from)
    .lte('metric_date', range.to)
    .limit(5000);

  if (error) throw error;
  return (data ?? []) as DailyMetricRecord[];
}

async function loadPosts(
  brandId: string,
  range: { from: string; to: string },
  db: ReturnType<typeof supabaseAdmin>
): Promise<PostMetricRecord[]> {
  const { data, error } = await db
    .from('post_metrics')
    .select(
      'external_post_id, social_post_id, platform, snapshot_date, published_at, impressions, reach, engagements, likes, comments, shares, saves, clicks, video_views'
    )
    .eq('brand_id', brandId)
    .gte('published_at', `${range.from}T00:00:00Z`)
    .lte('published_at', `${range.to}T23:59:59Z`)
    .limit(5000);

  if (error) throw error;
  return (data ?? []) as PostMetricRecord[];
}

async function loadAttribution(
  brandId: string,
  range: { from: string; to: string },
  db: ReturnType<typeof supabaseAdmin>
) {
  const { data } = await db
    .from('attribution_touchpoints')
    .select('platform, occurred_at, journey_key, clicks, conversions, revenue, spend')
    .eq('brand_id', brandId)
    .gte('occurred_at', `${range.from}T00:00:00Z`)
    .lte('occurred_at', `${range.to}T23:59:59Z`)
    .limit(20000);

  const touchpoints = (data ?? []) as TouchpointRecord[];
  if (touchpoints.length === 0) return null;

  return attribute(touchpoints, 'last_touch');
}
