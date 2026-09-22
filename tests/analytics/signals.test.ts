import { describe, it, expect } from 'vitest';
import {
  detectSignals,
  deriveConfidence,
  confidenceBand,
  MIN_CONFIDENCE_TO_REPORT,
  MIN_IMPRESSIONS_FOR_RATE,
  MIN_DAYS_FOR_TREND,
  type SignalInput,
} from '@/lib/analytics/signals';
import { summarize, sumTotals, type DailyMetricRecord } from '@/lib/analytics/metrics';

/**
 * Signal detection and confidence.
 *
 * The old optimizer compared totals against fixed thresholds and returned a
 * fixed sentence, with no confidence and no numbers. The tests here assert the
 * three properties that fix:
 *
 *   1. A signal is measured against the brand's OWN previous period.
 *   2. Confidence is derived from sample size and coverage, so the same rate
 *      from 200 impressions and 200,000 does not produce the same finding.
 *   3. A metric the platform never reported produces NO signal at all — not a
 *      crisis about a zero nobody measured.
 */

const RANGE = { from: '2026-08-11', to: '2026-09-09' };

function daysOfData(
  count: number,
  perDay: Partial<DailyMetricRecord>,
  reported = ['impressions', 'reach', 'engagements']
): DailyMetricRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    metric_date: new Date(Date.parse(`${RANGE.from}T00:00:00Z`) + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
    platform: 'instagram',
    reach: 0,
    impressions: 0,
    engagements: 0,
    clicks: 0,
    conversions: 0,
    video_views: 0,
    spend: 0,
    revenue: 0,
    raw_metrics: { metricsReported: reported },
    ...perDay,
  }));
}

function input(overrides: Partial<SignalInput> = {}): SignalInput {
  const rows = daysOfData(30, { impressions: 2000, engagements: 100, reach: 1500 });
  return {
    windowDays: 30,
    current: summarize(rows, RANGE),
    previous: { totals: sumTotals(daysOfData(30, { impressions: 2000, engagements: 100, reach: 1500 })), hasData: true },
    posts: [],
    attribution: null,
    ...overrides,
  };
}

describe('deriveConfidence', () => {
  it('rises with sample size', () => {
    const small = deriveConfidence({ sampleSize: 100, requiredSample: 1000, daysWithData: 30, daysRequested: 30 });
    const large = deriveConfidence({ sampleSize: 1000, requiredSample: 1000, daysWithData: 30, daysRequested: 30 });
    expect(large).toBeGreaterThan(small);
  });

  it('is capped by poor coverage, however large the sample', () => {
    // 90 days requested but only 3 measured is not a confident sample, even
    // with millions of impressions. Multiplying the factors is what enforces
    // that; a sum or average would hide it.
    const confident = deriveConfidence({
      sampleSize: 1_000_000,
      requiredSample: 1000,
      daysWithData: 3,
      daysRequested: 90,
    });
    expect(confident).toBeLessThan(0.1);
  });

  it('never reaches certainty', () => {
    // This is observational data from one brand, never a controlled experiment.
    const maxed = deriveConfidence({
      sampleSize: 10_000_000,
      requiredSample: 10,
      daysWithData: 90,
      daysRequested: 90,
      effectSize: 10,
      minimumEffect: 0.1,
    });
    expect(maxed).toBeLessThanOrEqual(0.95);
  });

  it('scales with effect size when one is given', () => {
    const base = { sampleSize: 5000, requiredSample: 5000, daysWithData: 30, daysRequested: 30 };
    const small = deriveConfidence({ ...base, effectSize: 0.15, minimumEffect: 0.15 });
    const large = deriveConfidence({ ...base, effectSize: 0.6, minimumEffect: 0.15 });
    expect(large).toBeGreaterThan(small);
  });

  it('returns zero when nothing was measured', () => {
    expect(
      deriveConfidence({ sampleSize: 0, requiredSample: 1000, daysWithData: 0, daysRequested: 30 })
    ).toBe(0);
  });

  it('handles a negative effect size by magnitude', () => {
    const base = { sampleSize: 5000, requiredSample: 5000, daysWithData: 30, daysRequested: 30, minimumEffect: 0.2 };
    expect(deriveConfidence({ ...base, effectSize: -0.4 })).toBe(
      deriveConfidence({ ...base, effectSize: 0.4 })
    );
  });
});

describe('confidenceBand', () => {
  it('bands at 0.7 and 0.4', () => {
    expect(confidenceBand(0.9)).toBe('high');
    expect(confidenceBand(0.7)).toBe('high');
    expect(confidenceBand(0.55)).toBe('moderate');
    expect(confidenceBand(0.4)).toBe('moderate');
    expect(confidenceBand(0.2)).toBe('low');
  });
});

describe('insufficient data', () => {
  it('returns one explicit signal rather than an empty list', () => {
    // An empty list renders as "no recommendations", which reads as
    // "everything is fine" — the opposite of the truth.
    const signals = detectSignals(input({ current: summarize([], RANGE), previous: null }));
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('insufficient_data');
    expect(signals[0].actionType).toBe('connect_analytics');
  });

  it('refuses to analyse below the impression floor', () => {
    const rows = daysOfData(30, { impressions: 5, engagements: 1 });
    const signals = detectSignals(input({ current: summarize(rows, RANGE) }));
    expect(signals[0].kind).toBe('insufficient_data');
    expect(signals[0].evidence.impressionsNeeded).toBe(MIN_IMPRESSIONS_FOR_RATE);
  });

  it('refuses to analyse below the day floor', () => {
    const rows = daysOfData(3, { impressions: 50_000, engagements: 2000 });
    const signals = detectSignals(input({ current: summarize(rows, RANGE) }));
    expect(signals[0].kind).toBe('insufficient_data');
    expect(signals[0].evidence.daysNeeded).toBe(MIN_DAYS_FOR_TREND);
  });
});

describe('engagement trend', () => {
  it('detects a decline against the brand own previous period', () => {
    const current = summarize(daysOfData(30, { impressions: 3000, engagements: 60 }), RANGE);
    const previous = { totals: sumTotals(daysOfData(30, { impressions: 3000, engagements: 150 })), hasData: true };

    const signals = detectSignals(input({ current, previous }));
    const declining = signals.find((signal) => signal.kind === 'engagement_declining');

    expect(declining).toBeDefined();
    expect(declining!.evidence.engagementRate).toBeCloseTo(0.02, 4);
    expect(declining!.evidence.previousEngagementRate).toBeCloseTo(0.05, 4);
    expect(declining!.priority).toBe('high');
  });

  it('detects an improvement', () => {
    const current = summarize(daysOfData(30, { impressions: 3000, engagements: 150 }), RANGE);
    const previous = { totals: sumTotals(daysOfData(30, { impressions: 3000, engagements: 60 })), hasData: true };

    const signals = detectSignals(input({ current, previous }));
    expect(signals.some((signal) => signal.kind === 'engagement_improving')).toBe(true);
  });

  it('ignores a change below the noise floor', () => {
    // 5% week-to-week movement at these volumes is not a finding.
    const current = summarize(daysOfData(30, { impressions: 3000, engagements: 105 }), RANGE);
    const previous = { totals: sumTotals(daysOfData(30, { impressions: 3000, engagements: 100 })), hasData: true };

    const signals = detectSignals(input({ current, previous }));
    expect(signals.some((signal) => signal.kind.startsWith('engagement_'))).toBe(false);
  });

  it('produces no trend signal without a comparable previous period', () => {
    const current = summarize(daysOfData(30, { impressions: 3000, engagements: 30 }), RANGE);
    const signals = detectSignals(input({ current, previous: null }));
    expect(signals.some((signal) => signal.kind.startsWith('engagement_'))).toBe(false);
  });

  it('cites the numbers it was computed from', () => {
    const current = summarize(daysOfData(30, { impressions: 3000, engagements: 60 }), RANGE);
    const previous = { totals: sumTotals(daysOfData(30, { impressions: 3000, engagements: 150 })), hasData: true };

    const signal = detectSignals(input({ current, previous })).find(
      (entry) => entry.kind === 'engagement_declining'
    )!;

    // Evidence is what makes the recommendation auditable rather than an
    // assertion — the database refuses a row without it.
    expect(Object.keys(signal.evidence).length).toBeGreaterThan(2);
    expect(signal.sampleSize).toBeGreaterThan(0);
  });
});

describe('the unreported-metric guard', () => {
  it('produces NO click-through signal when clicks were never reported', () => {
    // The bug this prevents: Instagram does not report clicks, the column
    // stores 0, and a naive check announces a 0% CTR crisis on every account.
    const rows = daysOfData(30, { impressions: 3000, engagements: 100, clicks: 0 }, [
      'impressions',
      'reach',
      'engagements',
    ]);
    const previousRows = daysOfData(30, { impressions: 3000, engagements: 100, clicks: 500 });

    const signals = detectSignals(
      input({ current: summarize(rows, RANGE), previous: { totals: sumTotals(previousRows), hasData: true } })
    );

    expect(signals.some((signal) => signal.kind === 'ctr_weak')).toBe(false);
  });

  it('does detect a CTR decline when clicks ARE reported', () => {
    const reported = ['impressions', 'reach', 'engagements', 'clicks'];
    const rows = daysOfData(30, { impressions: 3000, engagements: 100, clicks: 10 }, reported);
    const previousRows = daysOfData(30, { impressions: 3000, engagements: 100, clicks: 60 }, reported);

    const signals = detectSignals(
      input({ current: summarize(rows, RANGE), previous: { totals: sumTotals(previousRows), hasData: true } })
    );

    expect(signals.some((signal) => signal.kind === 'ctr_weak')).toBe(true);
  });

  it('produces no ROAS signal when spend was never recorded', () => {
    const rows = daysOfData(30, { impressions: 3000, engagements: 100, spend: 0, revenue: 0 });
    const signals = detectSignals(input({ current: summarize(rows, RANGE) }));
    expect(signals.some((signal) => signal.kind.startsWith('roas_'))).toBe(false);
  });

  it('detects negative ROAS when spend and revenue are both real', () => {
    const reported = ['impressions', 'reach', 'engagements'];
    const rows = daysOfData(30, { impressions: 3000, engagements: 100, spend: 100, revenue: 40 }, reported);
    const signals = detectSignals(input({ current: summarize(rows, RANGE) }));

    const roas = signals.find((signal) => signal.kind === 'roas_negative');
    expect(roas).toBeDefined();
    expect(roas!.priority).toBe('high');
  });
});

describe('post format signal', () => {
  const strongPost = (id: string, impressions: number, engagements: number) => ({
    externalPostId: id,
    socialPostId: null,
    platform: 'instagram',
    publishedAt: '2026-09-01T00:00:00Z',
    impressions,
    reach: impressions,
    engagements,
    clicks: 0,
    videoViews: 0,
    engagementRate: impressions > 0 ? engagements / impressions : null,
  });

  it('needs a minimum number of posts before comparing formats', () => {
    const posts = [strongPost('a', 1000, 200), strongPost('b', 1000, 10)];
    const signals = detectSignals(input({ posts }));
    expect(signals.some((signal) => signal.kind === 'top_format_outperforming')).toBe(false);
  });

  it('detects a strong top third with enough posts', () => {
    const posts = [
      strongPost('a', 2000, 400),
      strongPost('b', 2000, 380),
      strongPost('c', 2000, 40),
      strongPost('d', 2000, 35),
      strongPost('e', 2000, 30),
      strongPost('f', 2000, 25),
    ];

    const signals = detectSignals(input({ posts }));
    const format = signals.find((signal) => signal.kind === 'top_format_outperforming');

    expect(format).toBeDefined();
    expect(Number(format!.evidence.multiple)).toBeGreaterThan(1.5);
    expect(format!.evidence.bestPostId).toBe('a');
  });

  it('excludes posts too small to be meaningful from the comparison', () => {
    const posts = [
      ...Array.from({ length: 6 }, (_, index) => strongPost(`tiny${index}`, 10, 5)),
      ...Array.from({ length: 6 }, (_, index) => strongPost(`real${index}`, 3000, 60)),
    ];

    const signals = detectSignals(input({ posts }));
    const format = signals.find((signal) => signal.kind === 'top_format_outperforming');
    // The 50%-engagement 10-impression posts must not drive this.
    if (format) expect(Number(format.evidence.postsAnalysed)).toBe(6);
  });
});

describe('attribution coverage signal', () => {
  it('flags a high share of unattributable revenue', () => {
    const signals = detectSignals(
      input({ attribution: { unattributedRevenue: 700, attributedRevenue: 300, multiTouchJourneys: 2 } })
    );

    const signal = signals.find((entry) => entry.kind === 'unattributed_revenue');
    expect(signal).toBeDefined();
    expect(Number(signal!.evidence.unattributedShare)).toBeCloseTo(0.7, 3);
    expect(signal!.actionType).toBe('improve_tracking');
  });

  it('stays quiet when attribution coverage is good', () => {
    const signals = detectSignals(
      input({ attribution: { unattributedRevenue: 50, attributedRevenue: 950, multiTouchJourneys: 10 } })
    );
    expect(signals.some((entry) => entry.kind === 'unattributed_revenue')).toBe(false);
  });
});

describe('the confidence floor', () => {
  it('withholds signals below the reporting floor', () => {
    // Otherwise users learn to ignore the "low confidence" label, and a
    // decision on a 15%-confidence signal is worse than no recommendation.
    const rows = daysOfData(8, { impressions: 200, engagements: 2 }, ['impressions', 'engagements']);
    const previousRows = daysOfData(8, { impressions: 200, engagements: 20 });

    const signals = detectSignals({
      windowDays: 90,
      current: summarize(rows, { from: '2026-06-12', to: '2026-09-09' }),
      previous: { totals: sumTotals(previousRows), hasData: true },
      posts: [],
      attribution: null,
    });

    for (const signal of signals) {
      expect(signal.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE_TO_REPORT);
    }
  });

  it('sorts high priority first, then by confidence', () => {
    const rows = daysOfData(30, { impressions: 5000, engagements: 50, spend: 500, revenue: 100 });
    const previousRows = daysOfData(30, { impressions: 5000, engagements: 250 });

    const signals = detectSignals(
      input({ current: summarize(rows, RANGE), previous: { totals: sumTotals(previousRows), hasData: true } })
    );

    const priorityRank = { high: 0, medium: 1, low: 2 } as const;
    for (let index = 1; index < signals.length; index += 1) {
      expect(priorityRank[signals[index - 1].priority]).toBeLessThanOrEqual(
        priorityRank[signals[index].priority]
      );
    }
  });
});
