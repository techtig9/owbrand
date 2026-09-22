/**
 * Metric aggregation and derived rates.
 *
 * Kept pure and free of database access so the arithmetic can be tested
 * directly — every number the dashboard shows and every recommendation the
 * engine makes passes through here.
 *
 * The governing rule, from the master command's "do not fabricate analytics":
 * a metric nobody measured is NOT zero. `analytics_daily` stores 0 in the
 * numeric columns regardless, so the record of what was actually reported
 * lives in `raw_metrics.metricsReported`, and that is what `coverage` reads.
 * Without it, an Instagram account that never reports clicks would show a
 * confident "0 clicks, 0% CTR" — a measurement nobody took.
 */

export interface DailyMetricRecord {
  metric_date: string;
  platform: string;
  reach: number | string | null;
  impressions: number | string | null;
  engagements: number | string | null;
  clicks: number | string | null;
  conversions: number | string | null;
  video_views: number | string | null;
  spend: number | string | null;
  revenue: number | string | null;
  raw_metrics?: { metricsReported?: unknown } | null;
}

export const METRIC_FIELDS = [
  'reach',
  'impressions',
  'engagements',
  'clicks',
  'conversions',
  'videoViews',
  'spend',
  'revenue',
] as const;

export type MetricField = (typeof METRIC_FIELDS)[number];

export interface MetricTotals {
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
  conversions: number;
  videoViews: number;
  spend: number;
  revenue: number;
}

/** Rates are null, never zero, when their denominator was not measured. */
export interface DerivedRates {
  engagementRate: number | null;
  clickThroughRate: number | null;
  conversionRate: number | null;
  costPerClick: number | null;
  costPerConversion: number | null;
  roas: number | null;
}

export interface MetricCoverage {
  /** Days with at least one row. */
  daysWithData: number;
  /** Days in the requested range. */
  daysRequested: number;
  /** Which metrics any row in the range actually reported. */
  reported: MetricField[];
  /** Requested metrics no row reported. Rendered as "not measured". */
  unreported: MetricField[];
  platforms: string[];
  /** False when nothing at all was ingested for the range. */
  hasData: boolean;
}

export interface MetricSummary {
  totals: MetricTotals;
  rates: DerivedRates;
  coverage: MetricCoverage;
}

const EMPTY_TOTALS: MetricTotals = {
  reach: 0,
  impressions: 0,
  engagements: 0,
  clicks: 0,
  conversions: 0,
  videoViews: 0,
  spend: 0,
  revenue: 0,
};

/** Postgres returns bigint and numeric as strings through PostgREST. */
function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Maps a stored column name to the camelCase metric field. */
const FIELD_BY_COLUMN: Record<string, MetricField> = {
  reach: 'reach',
  impressions: 'impressions',
  engagements: 'engagements',
  clicks: 'clicks',
  conversions: 'conversions',
  video_views: 'videoViews',
  videoViews: 'videoViews',
  spend: 'spend',
  revenue: 'revenue',
};

function reportedFields(row: DailyMetricRecord): MetricField[] {
  const raw = row.raw_metrics?.metricsReported;
  if (!Array.isArray(raw)) return [];

  const fields: MetricField[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const field = FIELD_BY_COLUMN[entry];
    if (field && !fields.includes(field)) fields.push(field);
  }
  return fields;
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function sumTotals(rows: DailyMetricRecord[]): MetricTotals {
  return rows.reduce<MetricTotals>(
    (acc, row) => ({
      reach: acc.reach + num(row.reach),
      impressions: acc.impressions + num(row.impressions),
      engagements: acc.engagements + num(row.engagements),
      clicks: acc.clicks + num(row.clicks),
      conversions: acc.conversions + num(row.conversions),
      videoViews: acc.videoViews + num(row.video_views),
      spend: acc.spend + num(row.spend),
      revenue: acc.revenue + num(row.revenue),
    }),
    { ...EMPTY_TOTALS }
  );
}

/**
 * Derives rates.
 *
 * Every one returns null rather than 0 when its denominator is zero. A "0%
 * click-through rate" on an account with no impressions is a claim about
 * performance; null is the truth, and the UI renders it as "—".
 */
export function deriveRates(totals: MetricTotals): DerivedRates {
  const rate = (numerator: number, denominator: number): number | null =>
    denominator > 0 ? numerator / denominator : null;

  return {
    engagementRate: rate(totals.engagements, totals.impressions),
    clickThroughRate: rate(totals.clicks, totals.impressions),
    conversionRate: rate(totals.conversions, totals.clicks),
    costPerClick: rate(totals.spend, totals.clicks),
    costPerConversion: rate(totals.spend, totals.conversions),
    roas: rate(totals.revenue, totals.spend),
  };
}

export function computeCoverage(
  rows: DailyMetricRecord[],
  range: { from: string; to: string }
): MetricCoverage {
  const dates = new Set<string>();
  const platforms = new Set<string>();
  const reported = new Set<MetricField>();

  for (const row of rows) {
    dates.add(row.metric_date);
    if (row.platform) platforms.add(row.platform);
    for (const field of reportedFields(row)) reported.add(field);
  }

  // Spend and revenue never come from platform insights, so they are reported
  // only when a non-zero figure exists from another source. Treating a zero as
  // "reported" would claim we measured a brand's ad spend as nil.
  for (const row of rows) {
    if (num(row.spend) > 0) reported.add('spend');
    if (num(row.revenue) > 0) reported.add('revenue');
    if (num(row.conversions) > 0) reported.add('conversions');
  }

  const reportedList = METRIC_FIELDS.filter((field) => reported.has(field));

  return {
    daysWithData: dates.size,
    daysRequested: daysBetween(range.from, range.to),
    reported: reportedList,
    unreported: METRIC_FIELDS.filter((field) => !reported.has(field)),
    platforms: Array.from(platforms).sort(),
    hasData: rows.length > 0,
  };
}

export function summarize(rows: DailyMetricRecord[], range: { from: string; to: string }): MetricSummary {
  const totals = sumTotals(rows);
  return {
    totals,
    rates: deriveRates(totals),
    coverage: computeCoverage(rows, range),
  };
}

/* ------------------------------------------------------------------ *
 * Comparison
 * ------------------------------------------------------------------ */

export interface MetricDelta {
  current: number;
  previous: number;
  absolute: number;
  /** Null when the previous period had nothing to compare against. */
  percent: number | null;
  direction: 'up' | 'down' | 'flat' | 'new';
}

export type MetricComparison = Record<MetricField, MetricDelta>;

/**
 * Compares two periods.
 *
 * `percent` is null when the previous total was zero. The common alternative —
 * reporting +100%, or +∞, or silently showing 0% — turns "we had no data last
 * month" into a performance claim. `direction: 'new'` says what actually
 * happened.
 */
export function compareTotals(current: MetricTotals, previous: MetricTotals): MetricComparison {
  const comparison = {} as MetricComparison;

  for (const field of METRIC_FIELDS) {
    const now = current[field];
    const before = previous[field];
    const absolute = now - before;

    let percent: number | null = null;
    let direction: MetricDelta['direction'];

    if (before === 0) {
      percent = null;
      direction = now === 0 ? 'flat' : 'new';
    } else {
      percent = absolute / before;
      direction = absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat';
    }

    comparison[field] = { current: now, previous: before, absolute, percent, direction };
  }

  return comparison;
}

/**
 * The immediately preceding window of the same length.
 *
 * Same length matters: comparing a 30-day month against a 28-day one produces
 * a spurious ~7% swing in every total.
 */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const length = daysBetween(range.from, range.to);
  if (length === 0) return range;

  const fromMs = Date.parse(`${range.from}T00:00:00Z`);
  const previousTo = new Date(fromMs - 86_400_000);
  const previousFrom = new Date(previousTo.getTime() - (length - 1) * 86_400_000);

  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
  };
}

/* ------------------------------------------------------------------ *
 * Breakdowns
 * ------------------------------------------------------------------ */

export interface PlatformBreakdown {
  platform: string;
  totals: MetricTotals;
  rates: DerivedRates;
  /** This platform's share of impressions, or null when none were measured. */
  shareOfImpressions: number | null;
}

export function breakdownByPlatform(rows: DailyMetricRecord[]): PlatformBreakdown[] {
  const byPlatform = new Map<string, DailyMetricRecord[]>();

  for (const row of rows) {
    const list = byPlatform.get(row.platform) ?? [];
    list.push(row);
    byPlatform.set(row.platform, list);
  }

  const overall = sumTotals(rows);

  return Array.from(byPlatform.entries())
    .map(([platform, platformRows]) => {
      const totals = sumTotals(platformRows);
      return {
        platform,
        totals,
        rates: deriveRates(totals),
        shareOfImpressions: overall.impressions > 0 ? totals.impressions / overall.impressions : null,
      };
    })
    .sort((a, b) => b.totals.impressions - a.totals.impressions);
}

export interface TimeSeriesPoint {
  date: string;
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
}

/**
 * One point per day across the whole requested range.
 *
 * Days with no ingested row are filled with zeros AND flagged in coverage, so
 * a chart does not silently close a gap into a straight line that looks like
 * measured flat performance.
 */
export function toTimeSeries(
  rows: DailyMetricRecord[],
  range: { from: string; to: string }
): { points: TimeSeriesPoint[]; missingDates: string[] } {
  const byDate = new Map<string, DailyMetricRecord[]>();
  for (const row of rows) {
    const list = byDate.get(row.metric_date) ?? [];
    list.push(row);
    byDate.set(row.metric_date, list);
  }

  const points: TimeSeriesPoint[] = [];
  const missingDates: string[] = [];
  const length = daysBetween(range.from, range.to);
  const startMs = Date.parse(`${range.from}T00:00:00Z`);

  for (let index = 0; index < length; index += 1) {
    const date = new Date(startMs + index * 86_400_000).toISOString().slice(0, 10);
    const dayRows = byDate.get(date);

    if (!dayRows) missingDates.push(date);

    const totals = sumTotals(dayRows ?? []);
    points.push({
      date,
      reach: totals.reach,
      impressions: totals.impressions,
      engagements: totals.engagements,
      clicks: totals.clicks,
      conversions: totals.conversions,
      spend: totals.spend,
      revenue: totals.revenue,
    });
  }

  return { points, missingDates };
}

/* ------------------------------------------------------------------ *
 * Post performance
 * ------------------------------------------------------------------ */

export interface PostMetricRecord {
  external_post_id: string;
  social_post_id: string | null;
  platform: string;
  snapshot_date: string;
  published_at: string | null;
  impressions: number | string | null;
  reach: number | string | null;
  engagements: number | string | null;
  likes: number | string | null;
  comments: number | string | null;
  shares: number | string | null;
  saves: number | string | null;
  clicks: number | string | null;
  video_views: number | string | null;
}

export interface PostPerformance {
  externalPostId: string;
  socialPostId: string | null;
  platform: string;
  publishedAt: string | null;
  impressions: number;
  reach: number;
  engagements: number;
  clicks: number;
  videoViews: number;
  /** Null when impressions were not measured — not zero. */
  engagementRate: number | null;
}

/**
 * Latest snapshot per post.
 *
 * `post_metrics` accumulates one row per post per day, because engagement
 * keeps accruing. Summing them would multiply a post's impressions by the
 * number of days it was observed — so the most recent snapshot is the total.
 */
export function latestPerPost(rows: PostMetricRecord[]): PostPerformance[] {
  const latest = new Map<string, PostMetricRecord>();

  for (const row of rows) {
    const key = `${row.platform}:${row.external_post_id}`;
    const existing = latest.get(key);
    if (!existing || row.snapshot_date > existing.snapshot_date) latest.set(key, row);
  }

  return Array.from(latest.values())
    .map((row) => {
      const impressions = num(row.impressions);
      const engagements = num(row.engagements);
      return {
        externalPostId: row.external_post_id,
        socialPostId: row.social_post_id,
        platform: row.platform,
        publishedAt: row.published_at,
        impressions,
        reach: num(row.reach),
        engagements,
        clicks: num(row.clicks),
        videoViews: num(row.video_views),
        engagementRate: impressions > 0 ? engagements / impressions : null,
      };
    })
    .sort((a, b) => b.impressions - a.impressions);
}

/**
 * Ranks posts by engagement rate.
 *
 * Posts below `minImpressions` are excluded rather than ranked: a post with 12
 * impressions and 3 likes has a 25% engagement rate and tells you nothing, but
 * it would top every leaderboard and drive a recommendation.
 */
export function rankPosts(
  posts: PostPerformance[],
  options: { minImpressions?: number; limit?: number } = {}
): { ranked: PostPerformance[]; excludedForLowVolume: number } {
  const minImpressions = options.minImpressions ?? 100;
  const limit = options.limit ?? 10;

  const eligible = posts.filter(
    (post) => post.impressions >= minImpressions && post.engagementRate !== null
  );

  const ranked = [...eligible]
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
    .slice(0, limit);

  return { ranked, excludedForLowVolume: posts.length - eligible.length };
}
