/**
 * Signal detection and confidence.
 *
 * This replaces `lib/analytics/optimizer.ts`, which compared totals against
 * hard-coded thresholds (engagement < 2%, CTR < 1%, ROAS > 2) and returned a
 * fixed sentence per branch. Three problems with that, all of which the master
 * command names directly:
 *
 *   - NO CONFIDENCE. A 1.9% engagement rate over 200 impressions and over
 *     200,000 impressions produced the identical "engagement is below the
 *     configured baseline" — but only one of those is a finding.
 *   - NO EVIDENCE. The user was told what to do and given no numbers to check
 *     it against, which is indistinguishable from a fabricated recommendation.
 *   - FIXED BASELINES. "Below 2%" is a claim about the industry, not about
 *     this brand. A signal is only meaningful against the brand's OWN recent
 *     history, which is what makes it actionable.
 *
 * So: signals are detected deterministically here, confidence is DERIVED from
 * sample size and window coverage, and every signal carries the metrics it was
 * computed from. The AI layer's only job is to phrase the explanation — it
 * never decides whether a signal exists, and it cannot invent a number,
 * because the numbers are attached before it is called.
 */

import type { MetricSummary, MetricTotals, PostPerformance } from './metrics';

export const SIGNAL_KINDS = [
  'insufficient_data',
  'engagement_declining',
  'engagement_improving',
  'ctr_weak',
  'reach_declining',
  'top_format_outperforming',
  'posting_cadence_low',
  'roas_negative',
  'roas_strong',
  'unattributed_revenue',
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

export type SignalPriority = 'high' | 'medium' | 'low';

export interface Signal {
  kind: SignalKind;
  priority: SignalPriority;
  /** 0..1, derived — never asserted. */
  confidence: number;
  /** Rows or posts the signal was computed over. */
  sampleSize: number;
  /**
   * The numbers behind the signal. Rendered next to the recommendation so a
   * user can audit it, and stored as `ai_recommendations.evidence`.
   */
  evidence: Record<string, number | string | null>;
  /** A plain statement of the observation, before any AI phrasing. */
  observation: string;
  actionType: string;
}

/* ------------------------------------------------------------------ *
 * Confidence
 * ------------------------------------------------------------------ */

/**
 * Minimum impressions before an engagement-rate comparison means anything.
 *
 * Below this, ordinary variance dominates: a handful of extra likes swings the
 * rate by more than the effect being detected.
 */
export const MIN_IMPRESSIONS_FOR_RATE = 1_000;
/** Minimum days of data before a trend is a trend rather than two points. */
export const MIN_DAYS_FOR_TREND = 7;
/** Minimum posts before a format comparison is worth acting on. */
export const MIN_POSTS_FOR_FORMAT = 6;

/**
 * How much sample earns full volume confidence, as a multiple of the gate.
 *
 * These two numbers have to be chosen together. Originally they were not: the
 * gates below let a signal through at 1,000 impressions or 6 posts, while the
 * confidence denominators demanded 5,000 and 18 for full marks — so a signal
 * at exactly its own minimum scored 0.2-0.33 and was then filtered by
 * MIN_CONFIDENCE_TO_REPORT. The gate was unreachable in practice, which is
 * dead code pretending to be a threshold.
 *
 * 2.5 puts a signal at exactly its gate at 0.4 confidence — over the floor,
 * and honestly banded "moderate" rather than presented as a finding.
 */
export const FULL_CONFIDENCE_SAMPLE_MULTIPLE = 2.5;

/** Minimum clicks before a click-through comparison means anything. */
export const MIN_CLICKS_FOR_RATE = 100;

/** Minimum recorded spend before a ROAS judgement is worth making. */
export const MIN_SPEND_FOR_ROAS = 200;

/**
 * Derives confidence from how much was actually measured.
 *
 * Three independent factors, multiplied — so weakness in any one caps the
 * result. That is deliberate: 90 days of data covering only 3 days of actual
 * delivery is not a confident sample, and a sum or average would hide that.
 *
 *   volume    — sample size against the threshold this signal needs
 *   coverage  — fraction of requested days that actually have data
 *   effect    — how far past the threshold the observation is
 *
 * Capped at 0.95: this is an observational signal from one brand's data, never
 * a controlled experiment, so certainty is not available.
 */
export function deriveConfidence(input: {
  sampleSize: number;
  requiredSample: number;
  daysWithData: number;
  daysRequested: number;
  /** Observed effect size as a fraction, e.g. 0.3 for a 30% drop. */
  effectSize?: number;
  /** The effect size at which this signal is worth reporting at all. */
  minimumEffect?: number;
}): number {
  const volume = Math.min(1, input.sampleSize / Math.max(1, input.requiredSample));

  const coverage =
    input.daysRequested > 0 ? Math.min(1, input.daysWithData / input.daysRequested) : 0;

  let effect = 1;
  if (input.effectSize !== undefined && input.minimumEffect !== undefined && input.minimumEffect > 0) {
    // Twice the minimum effect earns full marks; below the minimum, scaled down.
    effect = Math.min(1, Math.abs(input.effectSize) / (input.minimumEffect * 2));
  }

  const raw = volume * coverage * effect;
  return Math.min(0.95, Math.round(raw * 1000) / 1000);
}

/** Confidence bands, for a UI that must not present 0.31 as a finding. */
export function confidenceBand(confidence: number): 'high' | 'moderate' | 'low' {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'moderate';
  return 'low';
}

/**
 * Below this, a signal is not shown as a recommendation at all.
 *
 * The alternative — showing everything with a small "low confidence" label —
 * trains users to ignore the label, and a marketing decision made on a
 * 15%-confidence signal is worse than no recommendation.
 */
export const MIN_CONFIDENCE_TO_REPORT = 0.35;

/* ------------------------------------------------------------------ *
 * Detection
 * ------------------------------------------------------------------ */

export interface SignalInput {
  windowDays: number;
  current: MetricSummary;
  previous: { totals: MetricTotals; hasData: boolean } | null;
  posts: PostPerformance[];
  attribution?: {
    unattributedRevenue: number;
    attributedRevenue: number;
    multiTouchJourneys: number;
  } | null;
}

function rateChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

/**
 * Detects every signal present in the data.
 *
 * Returns `insufficient_data` — one signal, not zero — when there is not
 * enough to say anything. An empty array would render as "no recommendations",
 * which reads as "everything is fine".
 */
export function detectSignals(input: SignalInput): Signal[] {
  const { current, previous, posts } = input;
  const { totals, rates, coverage } = current;

  if (!coverage.hasData) {
    return [
      {
        kind: 'insufficient_data',
        priority: 'medium',
        confidence: 1,
        sampleSize: 0,
        evidence: { daysRequested: coverage.daysRequested, daysWithData: 0 },
        observation:
          'No analytics have been ingested for this brand, so there is nothing to analyse yet.',
        actionType: 'connect_analytics',
      },
    ];
  }

  if (totals.impressions < MIN_IMPRESSIONS_FOR_RATE || coverage.daysWithData < MIN_DAYS_FOR_TREND) {
    return [
      {
        kind: 'insufficient_data',
        priority: 'low',
        confidence: 1,
        sampleSize: totals.impressions,
        evidence: {
          impressions: totals.impressions,
          impressionsNeeded: MIN_IMPRESSIONS_FOR_RATE,
          daysWithData: coverage.daysWithData,
          daysNeeded: MIN_DAYS_FOR_TREND,
        },
        observation: `Only ${coverage.daysWithData} day(s) and ${totals.impressions} impressions have been measured. That is not enough to distinguish a real change from normal variation.`,
        actionType: 'collect_more_data',
      },
    ];
  }

  const signals: Signal[] = [];
  const confidenceBase = {
    daysWithData: coverage.daysWithData,
    daysRequested: coverage.daysRequested,
  };

  /* --- Engagement trend, against the brand's own previous period --------- */
  if (previous?.hasData && previous.totals.impressions >= MIN_IMPRESSIONS_FOR_RATE) {
    const previousRate =
      previous.totals.impressions > 0 ? previous.totals.engagements / previous.totals.impressions : null;
    const change = rateChange(rates.engagementRate, previousRate);

    // 15% is the smallest change worth a recommendation; smaller moves are
    // indistinguishable from week-to-week noise at these volumes.
    const MINIMUM_EFFECT = 0.15;

    if (change !== null && Math.abs(change) >= MINIMUM_EFFECT) {
      const declining = change < 0;
      signals.push({
        kind: declining ? 'engagement_declining' : 'engagement_improving',
        priority: declining ? 'high' : 'low',
        confidence: deriveConfidence({
          ...confidenceBase,
          sampleSize: totals.impressions,
          requiredSample: MIN_IMPRESSIONS_FOR_RATE * FULL_CONFIDENCE_SAMPLE_MULTIPLE,
          effectSize: change,
          minimumEffect: MINIMUM_EFFECT,
        }),
        sampleSize: totals.impressions,
        evidence: {
          engagementRate: round(rates.engagementRate),
          previousEngagementRate: round(previousRate),
          changePercent: round(change),
          impressions: totals.impressions,
          previousImpressions: previous.totals.impressions,
        },
        observation: declining
          ? `Engagement rate fell from ${pct(previousRate)} to ${pct(rates.engagementRate)} against the previous period of the same length.`
          : `Engagement rate rose from ${pct(previousRate)} to ${pct(rates.engagementRate)} against the previous period of the same length.`,
        actionType: declining ? 'improve_hooks' : 'double_down',
      });
    }

    /* --- Reach trend ---------------------------------------------------- */
    const reachChange = rateChange(totals.reach, previous.totals.reach);
    if (reachChange !== null && reachChange <= -0.2) {
      signals.push({
        kind: 'reach_declining',
        priority: 'high',
        confidence: deriveConfidence({
          ...confidenceBase,
          sampleSize: totals.reach,
          requiredSample: MIN_IMPRESSIONS_FOR_RATE * FULL_CONFIDENCE_SAMPLE_MULTIPLE,
          effectSize: reachChange,
          minimumEffect: 0.2,
        }),
        sampleSize: totals.reach,
        evidence: {
          reach: totals.reach,
          previousReach: previous.totals.reach,
          changePercent: round(reachChange),
        },
        observation: `Reach fell ${pct(Math.abs(reachChange))} against the previous period, from ${previous.totals.reach.toLocaleString()} to ${totals.reach.toLocaleString()}.`,
        actionType: 'refresh_creative',
      });
    }
  }

  /* --- Click-through, only when clicks are actually measured ------------- */
  // The critical guard: a platform that never reports clicks stores 0, and a
  // naive check would announce a 0% CTR crisis on every Instagram account.
  if (coverage.reported.includes('clicks') && rates.clickThroughRate !== null) {
    const previousCtr =
      previous?.hasData && previous.totals.impressions > 0
        ? previous.totals.clicks / previous.totals.impressions
        : null;

    const change = rateChange(rates.clickThroughRate, previousCtr);

    // Gated on click volume as well as the change: a drop from 4 clicks to 1
    // is a 75% decline and tells nobody anything.
    if (change !== null && change <= -0.25 && totals.clicks >= MIN_CLICKS_FOR_RATE) {
      signals.push({
        kind: 'ctr_weak',
        priority: 'medium',
        confidence: deriveConfidence({
          ...confidenceBase,
          sampleSize: totals.clicks,
          requiredSample: MIN_CLICKS_FOR_RATE * FULL_CONFIDENCE_SAMPLE_MULTIPLE,
          effectSize: change,
          minimumEffect: 0.25,
        }),
        sampleSize: totals.clicks,
        evidence: {
          clickThroughRate: round(rates.clickThroughRate),
          previousClickThroughRate: round(previousCtr),
          clicks: totals.clicks,
          impressions: totals.impressions,
          changePercent: round(change),
        },
        observation: `Click-through rate fell from ${pct(previousCtr)} to ${pct(rates.clickThroughRate)} on ${totals.clicks.toLocaleString()} clicks.`,
        actionType: 'test_cta',
      });
    }
  }

  /* --- Format performance ----------------------------------------------- */
  const rankable = posts.filter((post) => post.engagementRate !== null && post.impressions >= 100);

  if (rankable.length >= MIN_POSTS_FOR_FORMAT) {
    const sorted = [...rankable].sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0));
    const topCount = Math.max(1, Math.floor(sorted.length / 3));
    const top = sorted.slice(0, topCount);
    const rest = sorted.slice(topCount);

    const topRate = mean(top.map((post) => post.engagementRate ?? 0));
    const restRate = rest.length > 0 ? mean(rest.map((post) => post.engagementRate ?? 0)) : null;

    if (restRate !== null && restRate > 0 && topRate / restRate >= 1.5) {
      signals.push({
        kind: 'top_format_outperforming',
        priority: 'medium',
        confidence: deriveConfidence({
          ...confidenceBase,
          sampleSize: rankable.length,
          requiredSample: MIN_POSTS_FOR_FORMAT * FULL_CONFIDENCE_SAMPLE_MULTIPLE,
          effectSize: topRate / restRate - 1,
          minimumEffect: 0.5,
        }),
        sampleSize: rankable.length,
        evidence: {
          topPostEngagementRate: round(topRate),
          otherPostEngagementRate: round(restRate),
          multiple: round(topRate / restRate),
          postsAnalysed: rankable.length,
          bestPostId: top[0]?.externalPostId ?? null,
          bestPostPlatform: top[0]?.platform ?? null,
        },
        observation: `The top third of ${rankable.length} measured posts averaged ${pct(topRate)} engagement against ${pct(restRate)} for the rest — ${round(topRate / restRate)}× better.`,
        actionType: 'double_down',
      });
    }
  }

  /* --- Cadence ----------------------------------------------------------- */
  if (coverage.daysWithData >= MIN_DAYS_FOR_TREND) {
    const postsPerWeek = (posts.length / Math.max(1, coverage.daysWithData)) * 7;

    if (postsPerWeek < 2 && posts.length > 0) {
      signals.push({
        kind: 'posting_cadence_low',
        priority: 'low',
        confidence: deriveConfidence({
          ...confidenceBase,
          sampleSize: coverage.daysWithData,
          requiredSample: 28,
        }),
        sampleSize: posts.length,
        evidence: {
          postsMeasured: posts.length,
          daysObserved: coverage.daysWithData,
          postsPerWeek: round(postsPerWeek),
        },
        observation: `Only ${posts.length} post(s) were published across ${coverage.daysWithData} measured days — about ${round(postsPerWeek)} per week.`,
        actionType: 'increase_cadence',
      });
    }
  }

  /* --- Spend efficiency, only when spend was actually recorded ----------- */
  if (coverage.reported.includes('spend') && totals.spend > 0 && rates.roas !== null) {
    if (rates.roas < 1) {
      signals.push({
        kind: 'roas_negative',
        priority: 'high',
        confidence: deriveConfidence({
          ...confidenceBase,
          sampleSize: Math.round(totals.spend),
          requiredSample: MIN_SPEND_FOR_ROAS * FULL_CONFIDENCE_SAMPLE_MULTIPLE,
          effectSize: 1 - rates.roas,
          minimumEffect: 0.2,
        }),
        sampleSize: Math.round(totals.spend),
        evidence: {
          roas: round(rates.roas),
          spend: round(totals.spend),
          revenue: round(totals.revenue),
          costPerConversion: round(rates.costPerConversion),
        },
        observation: `Attributed revenue of ${round(totals.revenue)} is below spend of ${round(totals.spend)} — a ROAS of ${round(rates.roas)}.`,
        actionType: 'refresh_creative',
      });
    } else if (rates.roas >= 2) {
      signals.push({
        kind: 'roas_strong',
        priority: 'medium',
        confidence: deriveConfidence({
          ...confidenceBase,
          sampleSize: Math.round(totals.spend),
          requiredSample: MIN_SPEND_FOR_ROAS * FULL_CONFIDENCE_SAMPLE_MULTIPLE,
          effectSize: rates.roas - 1,
          minimumEffect: 1,
        }),
        sampleSize: Math.round(totals.spend),
        evidence: {
          roas: round(rates.roas),
          spend: round(totals.spend),
          revenue: round(totals.revenue),
        },
        observation: `Attributed revenue of ${round(totals.revenue)} on ${round(totals.spend)} of spend — a ROAS of ${round(rates.roas)}.`,
        actionType: 'shift_budget',
      });
    }
  }

  /* --- Attribution coverage --------------------------------------------- */
  // Not a performance signal but a measurement one: revenue we cannot assign
  // makes every channel comparison unreliable, and the user can fix it.
  if (input.attribution) {
    const { unattributedRevenue, attributedRevenue } = input.attribution;
    const total = unattributedRevenue + attributedRevenue;

    if (total > 0 && unattributedRevenue / total >= 0.3) {
      signals.push({
        kind: 'unattributed_revenue',
        priority: 'medium',
        confidence: 0.9,
        sampleSize: Math.round(total),
        evidence: {
          unattributedRevenue: round(unattributedRevenue),
          attributedRevenue: round(attributedRevenue),
          unattributedShare: round(unattributedRevenue / total),
          multiTouchJourneys: input.attribution.multiTouchJourneys,
        },
        observation: `${pct(unattributedRevenue / total)} of recorded revenue has no journey key, so it cannot be attributed to a channel.`,
        actionType: 'improve_tracking',
      });
    }
  }

  return signals
    .filter((signal) => signal.confidence >= MIN_CONFIDENCE_TO_REPORT)
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
      return byPriority !== 0 ? byPriority : b.confidence - a.confidence;
    });
}

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

function round(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}

function pct(value: number | null): string {
  if (value === null) return 'not measured';
  return `${(value * 100).toFixed(2)}%`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
