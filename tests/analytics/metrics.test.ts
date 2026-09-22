import { describe, it, expect } from 'vitest';
import {
  sumTotals,
  deriveRates,
  computeCoverage,
  summarize,
  compareTotals,
  previousRange,
  daysBetween,
  breakdownByPlatform,
  toTimeSeries,
  latestPerPost,
  rankPosts,
  type DailyMetricRecord,
  type PostMetricRecord,
} from '@/lib/analytics/metrics';

/**
 * Metric aggregation.
 *
 * The recurring theme is the distinction between "measured zero" and "not
 * measured". The master command forbids fabricating analytics, and a
 * confident 0.00% CTR on a platform that never reports clicks is a fabricated
 * measurement. Every test below exists to keep that distinction alive through
 * one more layer.
 */

function daily(overrides: Partial<DailyMetricRecord> = {}): DailyMetricRecord {
  return {
    metric_date: '2026-09-01',
    platform: 'instagram',
    reach: 0,
    impressions: 0,
    engagements: 0,
    clicks: 0,
    conversions: 0,
    video_views: 0,
    spend: 0,
    revenue: 0,
    raw_metrics: { metricsReported: ['impressions', 'reach', 'engagements'] },
    ...overrides,
  };
}

describe('sumTotals', () => {
  it('adds across rows', () => {
    const totals = sumTotals([
      daily({ impressions: 100, engagements: 10 }),
      daily({ impressions: 250, engagements: 25 }),
    ]);
    expect(totals.impressions).toBe(350);
    expect(totals.engagements).toBe(35);
  });

  it('parses the strings PostgREST returns for bigint and numeric', () => {
    // Postgres bigint and numeric arrive as strings over the wire. Treating
    // them as numbers without parsing yields "100" + "250" = "100250".
    const totals = sumTotals([
      daily({ impressions: '100' as never, revenue: '19.99' as never }),
      daily({ impressions: '250' as never, revenue: '5.01' as never }),
    ]);
    expect(totals.impressions).toBe(350);
    expect(totals.revenue).toBeCloseTo(25, 2);
  });

  it('treats null and unparseable values as zero rather than NaN', () => {
    const totals = sumTotals([daily({ impressions: null, clicks: 'not a number' as never })]);
    expect(totals.impressions).toBe(0);
    expect(Number.isNaN(totals.clicks)).toBe(false);
  });

  it('returns zeros for no rows', () => {
    expect(sumTotals([]).impressions).toBe(0);
  });
});

describe('deriveRates', () => {
  it('computes rates when the denominator exists', () => {
    const rates = deriveRates({
      reach: 500,
      impressions: 1000,
      engagements: 50,
      clicks: 20,
      conversions: 4,
      videoViews: 0,
      spend: 100,
      revenue: 400,
    });

    expect(rates.engagementRate).toBeCloseTo(0.05, 6);
    expect(rates.clickThroughRate).toBeCloseTo(0.02, 6);
    expect(rates.conversionRate).toBeCloseTo(0.2, 6);
    expect(rates.costPerClick).toBeCloseTo(5, 6);
    expect(rates.roas).toBeCloseTo(4, 6);
  });

  it('returns NULL, not zero, when the denominator is zero', () => {
    // The central rule. A 0% engagement rate on zero impressions is a
    // performance claim; null is the truth and renders as "—".
    const rates = deriveRates({
      reach: 0,
      impressions: 0,
      engagements: 0,
      clicks: 0,
      conversions: 0,
      videoViews: 0,
      spend: 0,
      revenue: 0,
    });

    expect(rates.engagementRate).toBeNull();
    expect(rates.clickThroughRate).toBeNull();
    expect(rates.conversionRate).toBeNull();
    expect(rates.costPerClick).toBeNull();
    expect(rates.costPerConversion).toBeNull();
    expect(rates.roas).toBeNull();
  });

  it('reports zero ROAS as null when there was no spend, not as a failure', () => {
    const rates = deriveRates({
      reach: 0,
      impressions: 1000,
      engagements: 10,
      clicks: 0,
      conversions: 0,
      videoViews: 0,
      spend: 0,
      revenue: 500,
    });
    // Revenue with no recorded spend is not an infinite return.
    expect(rates.roas).toBeNull();
  });
});

describe('computeCoverage', () => {
  const range = { from: '2026-09-01', to: '2026-09-07' };

  it('reports which metrics the platform actually reported', () => {
    const coverage = computeCoverage([daily({ impressions: 100 })], range);
    expect(coverage.reported).toContain('impressions');
    expect(coverage.reported).toContain('engagements');
    // Never reported by Instagram insights, so it must not appear.
    expect(coverage.unreported).toContain('clicks');
  });

  it('does not count a zero as a reported spend', () => {
    // Otherwise the dashboard would claim it measured a brand's ad spend as nil.
    const coverage = computeCoverage([daily({ spend: 0, revenue: 0 })], range);
    expect(coverage.unreported).toContain('spend');
    expect(coverage.unreported).toContain('revenue');
  });

  it('counts a non-zero spend as reported even without a metricsReported entry', () => {
    const coverage = computeCoverage([daily({ spend: 250 })], range);
    expect(coverage.reported).toContain('spend');
  });

  it('counts distinct days, not rows', () => {
    // Two platforms on one date is one day of coverage.
    const coverage = computeCoverage(
      [
        daily({ metric_date: '2026-09-01', platform: 'instagram' }),
        daily({ metric_date: '2026-09-01', platform: 'facebook' }),
        daily({ metric_date: '2026-09-02' }),
      ],
      range
    );
    expect(coverage.daysWithData).toBe(2);
    expect(coverage.daysRequested).toBe(7);
    expect(coverage.platforms).toEqual(['facebook', 'instagram']);
  });

  it('reports hasData false for no rows, with every metric unreported', () => {
    const coverage = computeCoverage([], range);
    expect(coverage.hasData).toBe(false);
    expect(coverage.reported).toEqual([]);
    expect(coverage.unreported.length).toBeGreaterThan(0);
  });

  it('ignores a malformed metricsReported instead of throwing', () => {
    const coverage = computeCoverage(
      [daily({ raw_metrics: { metricsReported: 'impressions' as never } })],
      range
    );
    expect(coverage.reported).toEqual([]);
  });

  it('maps snake_case column names to metric fields', () => {
    const coverage = computeCoverage(
      [daily({ raw_metrics: { metricsReported: ['video_views'] } })],
      range
    );
    expect(coverage.reported).toContain('videoViews');
  });
});

describe('summarize', () => {
  it('combines totals, rates and coverage', () => {
    const result = summarize([daily({ impressions: 1000, engagements: 40 })], {
      from: '2026-09-01',
      to: '2026-09-01',
    });
    expect(result.totals.impressions).toBe(1000);
    expect(result.rates.engagementRate).toBeCloseTo(0.04, 6);
    expect(result.coverage.hasData).toBe(true);
  });
});

describe('compareTotals', () => {
  const zero = {
    reach: 0,
    impressions: 0,
    engagements: 0,
    clicks: 0,
    conversions: 0,
    videoViews: 0,
    spend: 0,
    revenue: 0,
  };

  it('computes a percentage change', () => {
    const comparison = compareTotals({ ...zero, impressions: 150 }, { ...zero, impressions: 100 });
    expect(comparison.impressions.percent).toBeCloseTo(0.5, 6);
    expect(comparison.impressions.direction).toBe('up');
  });

  it('reports a decline', () => {
    const comparison = compareTotals({ ...zero, impressions: 50 }, { ...zero, impressions: 100 });
    expect(comparison.impressions.percent).toBeCloseTo(-0.5, 6);
    expect(comparison.impressions.direction).toBe('down');
  });

  it('returns null percent and direction "new" when there was no prior data', () => {
    // The alternative is reporting +100% or +∞ — turning "we had no data last
    // month" into a performance claim.
    const comparison = compareTotals({ ...zero, impressions: 1000 }, zero);
    expect(comparison.impressions.percent).toBeNull();
    expect(comparison.impressions.direction).toBe('new');
  });

  it('reports flat when both periods are zero', () => {
    const comparison = compareTotals(zero, zero);
    expect(comparison.impressions.direction).toBe('flat');
    expect(comparison.impressions.percent).toBeNull();
  });

  it('covers every metric field', () => {
    const comparison = compareTotals(zero, zero);
    expect(Object.keys(comparison).sort()).toEqual(
      ['clicks', 'conversions', 'engagements', 'impressions', 'reach', 'revenue', 'spend', 'videoViews'].sort()
    );
  });
});

describe('previousRange', () => {
  it('returns the immediately preceding window of the same length', () => {
    // Same length matters: a 30-day month against a 28-day one invents a ~7%
    // swing in every total.
    expect(previousRange({ from: '2026-09-08', to: '2026-09-14' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-07',
    });
  });

  it('handles a single-day range', () => {
    expect(previousRange({ from: '2026-09-08', to: '2026-09-08' })).toEqual({
      from: '2026-09-07',
      to: '2026-09-07',
    });
  });

  it('spans a month boundary correctly', () => {
    expect(previousRange({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      from: '2026-08-02',
      to: '2026-08-31',
    });
  });
});

describe('daysBetween', () => {
  it('is inclusive of both endpoints', () => {
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(1);
    expect(daysBetween('2026-09-01', '2026-09-07')).toBe(7);
  });

  it('returns 0 for a reversed or invalid range', () => {
    expect(daysBetween('2026-09-07', '2026-09-01')).toBe(0);
    expect(daysBetween('nonsense', '2026-09-01')).toBe(0);
  });
});

describe('breakdownByPlatform', () => {
  it('groups and ranks by impressions', () => {
    const breakdown = breakdownByPlatform([
      daily({ platform: 'instagram', impressions: 300 }),
      daily({ platform: 'facebook', impressions: 700 }),
      daily({ platform: 'instagram', impressions: 200 }),
    ]);

    expect(breakdown[0].platform).toBe('facebook');
    expect(breakdown[0].totals.impressions).toBe(700);
    expect(breakdown[1].totals.impressions).toBe(500);
    expect(breakdown[0].shareOfImpressions).toBeCloseTo(0.5833, 3);
  });

  it('reports a null share when nothing was measured', () => {
    const breakdown = breakdownByPlatform([daily({ platform: 'instagram', impressions: 0 })]);
    expect(breakdown[0].shareOfImpressions).toBeNull();
  });
});

describe('toTimeSeries', () => {
  it('emits one point per day across the whole range', () => {
    const { points } = toTimeSeries([daily({ metric_date: '2026-09-02', impressions: 500 })], {
      from: '2026-09-01',
      to: '2026-09-03',
    });

    expect(points).toHaveLength(3);
    expect(points.map((point) => point.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(points[1].impressions).toBe(500);
  });

  it('flags days with no data so a chart does not close the gap', () => {
    // A line drawn through a missing week looks like measured flat performance.
    const { missingDates } = toTimeSeries([daily({ metric_date: '2026-09-02' })], {
      from: '2026-09-01',
      to: '2026-09-03',
    });
    expect(missingDates).toEqual(['2026-09-01', '2026-09-03']);
  });

  it('sums multiple platforms on the same day into one point', () => {
    const { points } = toTimeSeries(
      [
        daily({ metric_date: '2026-09-01', platform: 'instagram', impressions: 100 }),
        daily({ metric_date: '2026-09-01', platform: 'facebook', impressions: 250 }),
      ],
      { from: '2026-09-01', to: '2026-09-01' }
    );
    expect(points[0].impressions).toBe(350);
  });
});

/* ------------------------------------------------------------------ */

function post(overrides: Partial<PostMetricRecord> = {}): PostMetricRecord {
  return {
    external_post_id: 'p1',
    social_post_id: null,
    platform: 'instagram',
    snapshot_date: '2026-09-05',
    published_at: '2026-09-01T10:00:00Z',
    impressions: 1000,
    reach: 800,
    engagements: 50,
    likes: 40,
    comments: 5,
    shares: 3,
    saves: 2,
    clicks: 0,
    video_views: 0,
    ...overrides,
  };
}

describe('latestPerPost', () => {
  it('takes the latest snapshot rather than summing them', () => {
    // post_metrics accumulates a row per post per day; summing would multiply
    // a post's impressions by the number of days it was observed.
    const result = latestPerPost([
      post({ snapshot_date: '2026-09-03', impressions: 600 }),
      post({ snapshot_date: '2026-09-05', impressions: 1000 }),
      post({ snapshot_date: '2026-09-04', impressions: 850 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].impressions).toBe(1000);
  });

  it('keys on platform as well as post id', () => {
    const result = latestPerPost([
      post({ external_post_id: 'same', platform: 'instagram' }),
      post({ external_post_id: 'same', platform: 'facebook' }),
    ]);
    expect(result).toHaveLength(2);
  });

  it('reports a null engagement rate when impressions were not measured', () => {
    const result = latestPerPost([post({ impressions: 0, engagements: 5 })]);
    expect(result[0].engagementRate).toBeNull();
  });
});

describe('rankPosts', () => {
  it('excludes posts too small to rank, and says how many', () => {
    // A post with 12 impressions and 3 likes has a 25% engagement rate and
    // tells you nothing — but it would top every leaderboard.
    const posts = latestPerPost([
      post({ external_post_id: 'tiny', impressions: 12, engagements: 3 }),
      post({ external_post_id: 'real', impressions: 5000, engagements: 250 }),
    ]);

    const { ranked, excludedForLowVolume } = rankPosts(posts, { minImpressions: 100 });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].externalPostId).toBe('real');
    expect(excludedForLowVolume).toBe(1);
  });

  it('ranks by engagement rate, not raw impressions', () => {
    const posts = latestPerPost([
      post({ external_post_id: 'big', impressions: 10000, engagements: 100 }),
      post({ external_post_id: 'sharp', impressions: 1000, engagements: 90 }),
    ]);

    const { ranked } = rankPosts(posts);
    expect(ranked[0].externalPostId).toBe('sharp');
  });

  it('honours the limit', () => {
    const posts = latestPerPost(
      Array.from({ length: 20 }, (_, index) =>
        post({ external_post_id: `p${index}`, impressions: 1000, engagements: index * 10 })
      )
    );
    expect(rankPosts(posts, { limit: 5 }).ranked).toHaveLength(5);
  });
});
