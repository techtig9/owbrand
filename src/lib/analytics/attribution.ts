/**
 * Attribution.
 *
 * What this replaces summed `revenue` and `conversions` across every stored
 * touchpoint and called the platform with the largest sum the "top platform".
 * That is not attribution — it is double counting. If a customer saw an
 * Instagram post, clicked a Facebook ad and then converted, summing all three
 * touchpoints reports the revenue three times and credits whichever row
 * happened to carry the revenue figure.
 *
 * Attribution is a MODEL applied at read time, not a property of a row. Three
 * are implemented because they disagree in useful ways, and a brand should be
 * able to see that disagreement rather than be handed one number:
 *
 *   last_touch   — all credit to the final touch before conversion. The
 *                  industry default; over-credits closing channels.
 *   first_touch  — all credit to the first touch in the journey.
 *                  Over-credits discovery channels.
 *   linear       — credit split evenly across every touch in the journey.
 *
 * Journeys are grouped by `journey_key`. A touchpoint with no journey key
 * cannot participate in a multi-touch model, and is reported as unattributed
 * rather than being quietly assigned to itself — otherwise linear and
 * last-touch would produce identical numbers and look like agreement.
 */

export const ATTRIBUTION_MODELS = ['last_touch', 'first_touch', 'linear'] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

export interface TouchpointRecord {
  platform: string;
  occurred_at: string;
  journey_key?: string | null;
  clicks?: number | string | null;
  conversions?: number | string | null;
  revenue?: number | string | null;
  spend?: number | string | null;
  social_post_id?: string | null;
  campaign_id?: string | null;
}

export interface PlatformCredit {
  platform: string;
  /** Fractional under the linear model — a platform can earn 0.5 conversions. */
  conversions: number;
  revenue: number;
  clicks: number;
  spend: number;
  /** Null when no spend was recorded for the platform. */
  roas: number | null;
  /** Share of total attributed revenue, or null when none was attributed. */
  shareOfRevenue: number | null;
}

export interface AttributionResult {
  model: AttributionModel;
  credits: PlatformCredit[];
  totals: {
    conversions: number;
    revenue: number;
    clicks: number;
    spend: number;
    roas: number | null;
  };
  coverage: {
    touchpoints: number;
    /** Touchpoints carrying a journey key, so multi-touch is meaningful. */
    touchpointsInJourneys: number;
    journeys: number;
    /** Journeys with more than one touch — where models actually diverge. */
    multiTouchJourneys: number;
    /**
     * Revenue on touchpoints with no journey key. Reported, never silently
     * folded into a model's output.
     */
    unattributedRevenue: number;
    unattributedConversions: number;
    hasData: boolean;
  };
}

function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface Journey {
  key: string;
  touchpoints: TouchpointRecord[];
  conversions: number;
  revenue: number;
}

/**
 * Groups touchpoints into journeys.
 *
 * A journey's conversions and revenue are taken from its touchpoints — but
 * only ONCE. Most tracking implementations put the conversion value on the
 * converting touch, so summing across the journey would multiply it.
 */
function buildJourneys(touchpoints: TouchpointRecord[]): { journeys: Journey[]; orphans: TouchpointRecord[] } {
  const byKey = new Map<string, TouchpointRecord[]>();
  const orphans: TouchpointRecord[] = [];

  for (const touchpoint of touchpoints) {
    const key = touchpoint.journey_key?.trim();
    if (!key) {
      orphans.push(touchpoint);
      continue;
    }
    const list = byKey.get(key) ?? [];
    list.push(touchpoint);
    byKey.set(key, list);
  }

  const journeys: Journey[] = Array.from(byKey.entries()).map(([key, list]) => {
    const sorted = [...list].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));

    return {
      key,
      touchpoints: sorted,
      conversions: sorted.reduce((sum, t) => sum + num(t.conversions), 0),
      revenue: sorted.reduce((sum, t) => sum + num(t.revenue), 0),
    };
  });

  return { journeys, orphans };
}

/** Per-platform credit weights for one journey under a given model. */
function weightsFor(journey: Journey, model: AttributionModel): Map<string, number> {
  const weights = new Map<string, number>();
  const touches = journey.touchpoints;
  if (touches.length === 0) return weights;

  if (model === 'last_touch') {
    weights.set(touches[touches.length - 1].platform, 1);
    return weights;
  }

  if (model === 'first_touch') {
    weights.set(touches[0].platform, 1);
    return weights;
  }

  // Linear: even split per TOUCH, so a platform touched twice in one journey
  // earns twice the credit of one touched once.
  const share = 1 / touches.length;
  for (const touch of touches) {
    weights.set(touch.platform, (weights.get(touch.platform) ?? 0) + share);
  }
  return weights;
}

export function attribute(touchpoints: TouchpointRecord[], model: AttributionModel): AttributionResult {
  const { journeys, orphans } = buildJourneys(touchpoints);

  const credits = new Map<string, PlatformCredit>();
  const ensure = (platform: string): PlatformCredit => {
    const existing = credits.get(platform);
    if (existing) return existing;
    const created: PlatformCredit = {
      platform,
      conversions: 0,
      revenue: 0,
      clicks: 0,
      spend: 0,
      roas: null,
      shareOfRevenue: null,
    };
    credits.set(platform, created);
    return created;
  };

  // Clicks and spend are FACTS about a touchpoint, not credit to be modelled:
  // a platform's spend does not change because attribution changed. Every
  // touchpoint contributes them, journey or not.
  for (const touchpoint of touchpoints) {
    const credit = ensure(touchpoint.platform);
    credit.clicks += num(touchpoint.clicks);
    credit.spend += num(touchpoint.spend);
  }

  for (const journey of journeys) {
    const weights = weightsFor(journey, model);
    for (const [platform, weight] of weights) {
      const credit = ensure(platform);
      credit.conversions += journey.conversions * weight;
      credit.revenue += journey.revenue * weight;
    }
  }

  const attributedRevenue = Array.from(credits.values()).reduce((sum, credit) => sum + credit.revenue, 0);

  for (const credit of credits.values()) {
    credit.roas = credit.spend > 0 ? credit.revenue / credit.spend : null;
    credit.shareOfRevenue = attributedRevenue > 0 ? credit.revenue / attributedRevenue : null;
    // Floating-point noise from repeated 1/3 splits would otherwise surface as
    // 0.30000000000000004 conversions in the UI.
    credit.conversions = Math.round(credit.conversions * 1e6) / 1e6;
    credit.revenue = Math.round(credit.revenue * 100) / 100;
  }

  const totals = {
    conversions: journeys.reduce((sum, journey) => sum + journey.conversions, 0),
    revenue: Math.round(attributedRevenue * 100) / 100,
    clicks: touchpoints.reduce((sum, t) => sum + num(t.clicks), 0),
    spend: touchpoints.reduce((sum, t) => sum + num(t.spend), 0),
    roas: null as number | null,
  };
  totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : null;

  return {
    model,
    credits: Array.from(credits.values()).sort((a, b) => b.revenue - a.revenue),
    totals,
    coverage: {
      touchpoints: touchpoints.length,
      touchpointsInJourneys: touchpoints.length - orphans.length,
      journeys: journeys.length,
      multiTouchJourneys: journeys.filter((journey) => journey.touchpoints.length > 1).length,
      unattributedRevenue:
        Math.round(orphans.reduce((sum, t) => sum + num(t.revenue), 0) * 100) / 100,
      unattributedConversions: orphans.reduce((sum, t) => sum + num(t.conversions), 0),
      hasData: touchpoints.length > 0,
    },
  };
}

/**
 * Runs every model over the same touchpoints.
 *
 * Showing all three is the point: when they agree, a channel's contribution is
 * robust; when they diverge sharply, the brand is looking at a discovery
 * channel being under-credited by last-touch, and that is the actionable fact.
 */
export function attributeAllModels(touchpoints: TouchpointRecord[]): Record<AttributionModel, AttributionResult> {
  return {
    last_touch: attribute(touchpoints, 'last_touch'),
    first_touch: attribute(touchpoints, 'first_touch'),
    linear: attribute(touchpoints, 'linear'),
  };
}

/**
 * How much the models disagree about a platform, as a fraction of attributed
 * revenue. High disagreement is a signal worth surfacing, not an error.
 */
export function modelDisagreement(
  results: Record<AttributionModel, AttributionResult>
): Array<{ platform: string; min: number; max: number; spread: number | null }> {
  const platforms = new Set<string>();
  for (const model of ATTRIBUTION_MODELS) {
    for (const credit of results[model].credits) platforms.add(credit.platform);
  }

  return Array.from(platforms)
    .map((platform) => {
      const revenues = ATTRIBUTION_MODELS.map(
        (model) => results[model].credits.find((credit) => credit.platform === platform)?.revenue ?? 0
      );
      const min = Math.min(...revenues);
      const max = Math.max(...revenues);
      return {
        platform,
        min,
        max,
        spread: max > 0 ? (max - min) / max : null,
      };
    })
    .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0));
}
