import { describe, it, expect } from 'vitest';
import {
  attribute,
  attributeAllModels,
  modelDisagreement,
  ATTRIBUTION_MODELS,
  type TouchpointRecord,
} from '@/lib/analytics/attribution';

/**
 * Attribution models.
 *
 * The defect these replace: the old `summarizeAttribution` summed revenue
 * across every touchpoint. A journey where a customer saw an Instagram post,
 * clicked a Facebook ad and converted reported the revenue up to three times,
 * and credited whichever row happened to carry the figure.
 *
 * The first test below is that bug, written as an assertion.
 */

function touch(overrides: Partial<TouchpointRecord> = {}): TouchpointRecord {
  return {
    platform: 'instagram',
    occurred_at: '2026-09-01T10:00:00Z',
    journey_key: 'j1',
    clicks: 0,
    conversions: 0,
    revenue: 0,
    spend: 0,
    ...overrides,
  };
}

/** One customer: saw Instagram, then Facebook, then converted on Facebook. */
const JOURNEY: TouchpointRecord[] = [
  touch({ platform: 'instagram', occurred_at: '2026-09-01T10:00:00Z', clicks: 1 }),
  touch({ platform: 'facebook', occurred_at: '2026-09-02T10:00:00Z', clicks: 1 }),
  touch({
    platform: 'facebook',
    occurred_at: '2026-09-03T10:00:00Z',
    conversions: 1,
    revenue: 300,
  }),
];

describe('the double-counting bug', () => {
  it('never reports more revenue than actually occurred', () => {
    // The old implementation summed every touchpoint's revenue. Here the
    // journey generated 300 once, and every model must total 300 — no more.
    for (const model of ATTRIBUTION_MODELS) {
      const result = attribute(JOURNEY, model);
      expect(result.totals.revenue).toBeCloseTo(300, 2);
    }
  });

  it('never reports more conversions than occurred', () => {
    for (const model of ATTRIBUTION_MODELS) {
      expect(attribute(JOURNEY, model).totals.conversions).toBeCloseTo(1, 6);
    }
  });
});

describe('last_touch', () => {
  it('credits the final touch in the journey', () => {
    const result = attribute(JOURNEY, 'last_touch');
    const facebook = result.credits.find((credit) => credit.platform === 'facebook');
    const instagram = result.credits.find((credit) => credit.platform === 'instagram');

    expect(facebook?.revenue).toBeCloseTo(300, 2);
    // Instagram introduced the customer and gets nothing — the known bias of
    // this model, which is why all three are offered.
    expect(instagram?.revenue).toBeCloseTo(0, 6);
  });
});

describe('first_touch', () => {
  it('credits the first touch in the journey', () => {
    const result = attribute(JOURNEY, 'first_touch');
    expect(result.credits.find((credit) => credit.platform === 'instagram')?.revenue).toBeCloseTo(300, 2);
    expect(result.credits.find((credit) => credit.platform === 'facebook')?.revenue).toBeCloseTo(0, 6);
  });

  it('orders by time, not by array position', () => {
    // The rows arrive in whatever order the query returned.
    const shuffled = [JOURNEY[2], JOURNEY[0], JOURNEY[1]];
    const result = attribute(shuffled, 'first_touch');
    expect(result.credits.find((credit) => credit.platform === 'instagram')?.revenue).toBeCloseTo(300, 2);
  });
});

describe('linear', () => {
  it('splits credit evenly across every touch', () => {
    const result = attribute(JOURNEY, 'linear');
    const instagram = result.credits.find((credit) => credit.platform === 'instagram');
    const facebook = result.credits.find((credit) => credit.platform === 'facebook');

    // One Instagram touch of three, two Facebook touches of three.
    expect(instagram?.revenue).toBeCloseTo(100, 2);
    expect(facebook?.revenue).toBeCloseTo(200, 2);
  });

  it('weights a platform by how many touches it contributed', () => {
    const result = attribute(JOURNEY, 'linear');
    expect(result.credits.find((credit) => credit.platform === 'facebook')?.conversions).toBeCloseTo(2 / 3, 5);
  });

  it('rounds away floating-point noise from repeated thirds', () => {
    const result = attribute(JOURNEY, 'linear');
    for (const credit of result.credits) {
      expect(String(credit.revenue)).not.toMatch(/\d{10,}/);
    }
  });
});

describe('facts that are not modelled', () => {
  it('attributes clicks and spend to the platform that incurred them', () => {
    // A platform's spend does not change because attribution changed.
    const touchpoints = [
      touch({ platform: 'instagram', clicks: 10, spend: 50 }),
      touch({ platform: 'facebook', clicks: 5, spend: 100, conversions: 1, revenue: 400 }),
    ];

    for (const model of ATTRIBUTION_MODELS) {
      const result = attribute(touchpoints, model);
      expect(result.credits.find((credit) => credit.platform === 'instagram')?.spend).toBe(50);
      expect(result.credits.find((credit) => credit.platform === 'facebook')?.clicks).toBe(5);
    }
  });

  it('counts spend from touchpoints with no journey key', () => {
    const result = attribute([touch({ journey_key: null, spend: 75, platform: 'facebook' })], 'linear');
    expect(result.credits.find((credit) => credit.platform === 'facebook')?.spend).toBe(75);
  });
});

describe('unattributed revenue', () => {
  it('reports revenue with no journey key rather than folding it into a model', () => {
    // Silently assigning it would make every channel comparison wrong and
    // hide a fixable tracking problem.
    const result = attribute(
      [
        ...JOURNEY,
        touch({ journey_key: null, platform: 'instagram', conversions: 2, revenue: 500 }),
      ],
      'last_touch'
    );

    expect(result.coverage.unattributedRevenue).toBeCloseTo(500, 2);
    expect(result.coverage.unattributedConversions).toBe(2);
    // And it is NOT in the attributed total.
    expect(result.totals.revenue).toBeCloseTo(300, 2);
  });

  it('treats a whitespace-only journey key as absent', () => {
    const result = attribute([touch({ journey_key: '   ', revenue: 100 })], 'linear');
    expect(result.coverage.unattributedRevenue).toBeCloseTo(100, 2);
    expect(result.coverage.journeys).toBe(0);
  });
});

describe('ROAS', () => {
  it('computes return on spend per platform', () => {
    const result = attribute(
      [
        touch({ platform: 'facebook', spend: 100 }),
        touch({ platform: 'facebook', conversions: 1, revenue: 350 }),
      ],
      'last_touch'
    );
    expect(result.credits.find((credit) => credit.platform === 'facebook')?.roas).toBeCloseTo(3.5, 4);
  });

  it('reports null ROAS when no spend was recorded, not infinity', () => {
    const result = attribute([touch({ conversions: 1, revenue: 500 })], 'last_touch');
    expect(result.credits[0].roas).toBeNull();
    expect(result.totals.roas).toBeNull();
  });

  it('reports a null revenue share when nothing was attributed', () => {
    const result = attribute([touch({ clicks: 5 })], 'last_touch');
    expect(result.credits[0].shareOfRevenue).toBeNull();
  });
});

describe('coverage', () => {
  it('counts journeys and multi-touch journeys separately', () => {
    const result = attribute(
      [
        ...JOURNEY,
        touch({ journey_key: 'j2', platform: 'facebook', conversions: 1, revenue: 50 }),
      ],
      'linear'
    );

    expect(result.coverage.journeys).toBe(2);
    // Only where the models can actually diverge.
    expect(result.coverage.multiTouchJourneys).toBe(1);
  });

  it('reports hasData false for no touchpoints', () => {
    const result = attribute([], 'last_touch');
    expect(result.coverage.hasData).toBe(false);
    expect(result.totals.revenue).toBe(0);
    expect(result.credits).toEqual([]);
  });

  it('separates touchpoints in journeys from orphans', () => {
    const result = attribute([...JOURNEY, touch({ journey_key: null })], 'linear');
    expect(result.coverage.touchpoints).toBe(4);
    expect(result.coverage.touchpointsInJourneys).toBe(3);
  });
});

describe('attributeAllModels and disagreement', () => {
  it('runs all three models over the same touchpoints', () => {
    const results = attributeAllModels(JOURNEY);
    expect(Object.keys(results).sort()).toEqual(['first_touch', 'last_touch', 'linear']);
  });

  it('surfaces where the models disagree most', () => {
    const results = attributeAllModels(JOURNEY);
    const disagreement = modelDisagreement(results);

    // Instagram gets 300 under first-touch and 0 under last-touch: total
    // disagreement, and the actionable insight.
    const instagram = disagreement.find((entry) => entry.platform === 'instagram');
    expect(instagram?.min).toBeCloseTo(0, 6);
    expect(instagram?.max).toBeCloseTo(300, 2);
    expect(instagram?.spread).toBeCloseTo(1, 4);
  });

  it('reports no disagreement for a single-touch journey', () => {
    const single = [touch({ journey_key: 'j9', conversions: 1, revenue: 100 })];
    const disagreement = modelDisagreement(attributeAllModels(single));
    expect(disagreement[0].spread).toBeCloseTo(0, 6);
  });

  it('sorts the most disputed platform first', () => {
    const results = attributeAllModels(JOURNEY);
    const disagreement = modelDisagreement(results);
    expect(disagreement[0].spread ?? 0).toBeGreaterThanOrEqual(disagreement[disagreement.length - 1].spread ?? 0);
  });
});

describe('string inputs from PostgREST', () => {
  it('parses numeric revenue delivered as a string', () => {
    const result = attribute(
      [touch({ revenue: '150.50' as never, conversions: '1' as never })],
      'last_touch'
    );
    expect(result.totals.revenue).toBeCloseTo(150.5, 2);
    expect(result.totals.conversions).toBe(1);
  });
});
