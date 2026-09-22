import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  summarize,
  sumTotals,
  previousRange,
  latestPerPost,
  type DailyMetricRecord,
  type PostMetricRecord,
} from './metrics';
import { detectSignals } from './signals';
import { attribute, type TouchpointRecord } from './attribution';
import { generateRecommendations } from './recommendations';
import { logger } from '@/lib/logger';

/**
 * Scheduled recommendation refresh.
 *
 * Runs after ingestion, for every brand that actually has data. Two reasons it
 * belongs on a schedule rather than on page load:
 *
 *   - The AI phrasing pass costs a provider call. Doing it when the dashboard
 *     opens would make the page slow and would bill a call per visit.
 *   - A brand whose engagement has collapsed should have that recommendation
 *     waiting for them, not generated only if they happen to look.
 *
 * Brands with no ingested data are skipped entirely: `detectSignals` would
 * return `insufficient_data`, and writing that row for every brand on every
 * run would bury the real findings.
 */

type Db = SupabaseClient<any, any, any>;

const WINDOW_DAYS = 30;
const MAX_BRANDS_PER_RUN = 50;

export interface RefreshSummary {
  brandsConsidered: number;
  brandsRefreshed: number;
  recommendationsWritten: number;
  skippedForNoData: number;
}

export async function refreshRecommendationsForAllBrands(
  options: { db?: Db; limit?: number } = {}
): Promise<RefreshSummary> {
  const db = options.db ?? supabaseAdmin();
  const limit = Math.min(Math.max(options.limit ?? MAX_BRANDS_PER_RUN, 1), 200);

  const summary: RefreshSummary = {
    brandsConsidered: 0,
    brandsRefreshed: 0,
    recommendationsWritten: 0,
    skippedForNoData: 0,
  };

  const to = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (WINDOW_DAYS - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Only brands with rows in the window. A brand with no analytics has nothing
  // to recommend, and asking anyway would cost a query per brand for nothing.
  const { data: brandRows, error } = await db
    .from('analytics_daily')
    .select('brand_id')
    .gte('metric_date', from)
    .lte('metric_date', to)
    .limit(5000);

  if (error) throw error;

  const brandIds = Array.from(
    new Set(((brandRows ?? []) as Array<{ brand_id: string }>).map((row) => row.brand_id))
  ).slice(0, limit);

  summary.brandsConsidered = brandIds.length;

  for (const brandId of brandIds) {
    try {
      const written = await refreshBrand(brandId, { from, to }, db);
      if (written === null) summary.skippedForNoData += 1;
      else {
        summary.brandsRefreshed += 1;
        summary.recommendationsWritten += written;
      }
    } catch (error) {
      // One brand's failure must not stop the rest.
      logger.warn('recommendations:refresh_brand_failed', {
        brandId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('recommendations:refresh_completed', {
    brandsConsidered: summary.brandsConsidered,
    brandsRefreshed: summary.brandsRefreshed,
    recommendationsWritten: summary.recommendationsWritten,
    skippedForNoData: summary.skippedForNoData,
  });

  return summary;
}

/** Returns the number of recommendations written, or null when skipped. */
async function refreshBrand(
  brandId: string,
  range: { from: string; to: string },
  db: Db
): Promise<number | null> {
  const rows = await loadDaily(brandId, range, db);
  if (rows.length === 0) return null;

  const summary = summarize(rows, range);
  const previous = previousRange(range);
  const previousRows = await loadDaily(brandId, previous, db);

  const { data: postRows } = await db
    .from('post_metrics')
    .select(
      'external_post_id, social_post_id, platform, snapshot_date, published_at, impressions, reach, engagements, likes, comments, shares, saves, clicks, video_views'
    )
    .eq('brand_id', brandId)
    .gte('published_at', `${range.from}T00:00:00Z`)
    .lte('published_at', `${range.to}T23:59:59Z`)
    .limit(5000);

  const posts = latestPerPost((postRows ?? []) as PostMetricRecord[]);

  const { data: touchRows } = await db
    .from('attribution_touchpoints')
    .select('platform, occurred_at, journey_key, clicks, conversions, revenue, spend')
    .eq('brand_id', brandId)
    .gte('occurred_at', `${range.from}T00:00:00Z`)
    .lte('occurred_at', `${range.to}T23:59:59Z`)
    .limit(20000);

  const touchpoints = (touchRows ?? []) as TouchpointRecord[];
  const attribution = touchpoints.length > 0 ? attribute(touchpoints, 'last_touch') : null;

  const signals = detectSignals({
    windowDays: WINDOW_DAYS,
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

  // Nothing actionable. Not an error, and not worth a row.
  const actionable = signals.filter((signal) => signal.kind !== 'insufficient_data');
  if (actionable.length === 0) return 0;

  const { data: brand } = await db.from('brands').select('workspace_id').eq('id', brandId).maybeSingle();

  const { recommendations } = await generateRecommendations({
    brandId,
    workspaceId: (brand as { workspace_id: string | null } | null)?.workspace_id ?? null,
    windowDays: WINDOW_DAYS,
    signals: actionable,
    db,
  });

  return recommendations.length;
}

async function loadDaily(
  brandId: string,
  range: { from: string; to: string },
  db: Db
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
