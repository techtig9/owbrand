import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit economics.
 *
 * The assertions that matter are the ones about absent data. A plan with no
 * users reporting a 100% margin is the specific failure this module exists to
 * avoid: it is the number a founder would price a launch around, and it would
 * be an artefact of dividing by nothing.
 */

let subscriptions: Array<Record<string, unknown>> = [];
let usage: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const data = table === 'subscriptions' ? subscriptions : usage;
      const builder = {
        select: () => builder,
        gte: () => builder,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  subscriptions = [];
  usage = [];
  vi.resetModules();
});

async function load() {
  return import('@/lib/economics');
}

describe('margins', () => {
  it('computes cost per user and margin for a paid plan', async () => {
    subscriptions = [
      { user_id: 'u1', plan: 'pro', status: 'active' },
      { user_id: 'u2', plan: 'pro', status: 'active' },
    ];
    usage = [
      { user_id: 'u1', estimated_cost_usd: 10 },
      { user_id: 'u2', estimated_cost_usd: 30 },
    ];

    const { computeEconomics } = await load();
    const report = await computeEconomics(30);
    const pro = report.plans.find((plan) => plan.plan === 'pro')!;

    expect(pro.activeUsers).toBe(2);
    expect(pro.costPerUserUsd).toBe(20);
    // 79 price, 20 cost -> 74.7% margin.
    expect(pro.margin).toBeCloseTo(0.747, 2);
    expect(pro.negative).toBe(false);
  });

  it('flags a plan that costs more than it charges', async () => {
    subscriptions = [{ user_id: 'u1', plan: 'starter', status: 'active' }];
    usage = [{ user_id: 'u1', estimated_cost_usd: 45 }];

    const { computeEconomics } = await load();
    const report = await computeEconomics(30);
    const starter = report.plans.find((plan) => plan.plan === 'starter')!;

    expect(starter.negative).toBe(true);
    expect(starter.margin).toBeLessThan(0);
    expect(report.lossMaking).toContain('starter');
  });

  it('reports a plan with no users as null, NOT as a 100% margin', async () => {
    // The whole point of the module. Zero cost across zero users is no data,
    // and a dashboard rendering it as a healthy green 100% is the number
    // someone would price a launch around.
    const { computeEconomics } = await load();
    const report = await computeEconomics(30);

    for (const plan of report.plans) {
      expect(plan.activeUsers).toBe(0);
      expect(plan.costPerUserUsd).toBeNull();
      expect(plan.margin).toBeNull();
      expect(plan.negative).toBe(false);
    }
  });

  it('does not treat the free plan as loss-making', async () => {
    // It has no price to lose against, and flagging it would bury a paid plan
    // that genuinely is.
    subscriptions = [{ user_id: 'u1', plan: 'free', status: 'active' }];
    usage = [{ user_id: 'u1', estimated_cost_usd: 99 }];

    const { computeEconomics } = await load();
    const report = await computeEconomics(30);
    const free = report.plans.find((plan) => plan.plan === 'free')!;

    expect(free.costPerUserUsd).toBe(99);
    expect(free.margin).toBeNull();
    expect(free.negative).toBe(false);
    expect(report.lossMaking).toHaveLength(0);
  });

  it('ignores cancelled subscriptions', async () => {
    subscriptions = [
      { user_id: 'u1', plan: 'pro', status: 'active' },
      { user_id: 'u2', plan: 'pro', status: 'cancelled' },
    ];
    usage = [{ user_id: 'u1', estimated_cost_usd: 10 }];

    const { computeEconomics } = await load();
    const pro = (await computeEconomics(30)).plans.find((plan) => plan.plan === 'pro')!;
    expect(pro.activeUsers).toBe(1);
  });
});

describe('usage from deleted accounts', () => {
  it('counts it in the total but attributes it to no plan', async () => {
    // The FK is `set null`, so usage survives the account. The money was spent
    // and belongs in the total; attributing it to a plan would overstate that
    // plan's cost per user.
    subscriptions = [{ user_id: 'u1', plan: 'pro', status: 'active' }];
    usage = [
      { user_id: 'u1', estimated_cost_usd: 10 },
      { user_id: null, estimated_cost_usd: 50 },
    ];

    const { computeEconomics } = await load();
    const report = await computeEconomics(30);

    expect(report.totalCostUsd).toBe(60);
    expect(report.plans.find((plan) => plan.plan === 'pro')!.costPerUserUsd).toBe(10);
  });
});

describe('free-tier burn', () => {
  it('computes the conversion rate needed to break even', async () => {
    subscriptions = [
      { user_id: 'f1', plan: 'free', status: 'active' },
      { user_id: 'f2', plan: 'free', status: 'active' },
    ];
    usage = [
      { user_id: 'f1', estimated_cost_usd: 2 },
      { user_id: 'f2', estimated_cost_usd: 4 },
    ];

    const { computeEconomics, freeTierBurn } = await load();
    const burn = freeTierBurn(await computeEconomics(30));

    expect(burn.costPerFreeUserUsd).toBe(3);
    expect(burn.monthlyBurnUsd).toBe(6);
    // $3 per free user against a $29 starter plan: about 10.3% must convert.
    expect(burn.breakEvenConversionRate).toBeCloseTo(0.1034, 3);
  });

  it('reports null rather than a fabricated rate with no free users', async () => {
    const { computeEconomics, freeTierBurn } = await load();
    const burn = freeTierBurn(await computeEconomics(30));
    expect(burn.costPerFreeUserUsd).toBeNull();
    expect(burn.breakEvenConversionRate).toBeNull();
  });
});

describe('the caveat', () => {
  it('travels with the report', async () => {
    const { computeEconomics } = await load();
    const report = await computeEconomics(30);
    // Close enough to price a plan, not close enough to reconcile an invoice —
    // and a caller cannot drop it.
    expect(report.caveat).toMatch(/estimates/i);
    expect(report.caveat).toMatch(/not.*reconcile/i);
  });
});
