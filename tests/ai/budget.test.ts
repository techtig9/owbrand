import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spend controls.
 *
 * The tests that matter here are the ones about *failure modes*, not about the
 * arithmetic:
 *
 *  - the kill switch works without touching the database, because during an
 *    incident the database may be the problem;
 *  - an unreadable usage table fails OPEN, because refusing every generation
 *    when metrics are down turns a metrics outage into a product outage;
 *  - spend is folded into the cache immediately, because a cap that only
 *    notices after the cache window has expired leaves precisely the gap a
 *    runaway loop needs.
 *
 * `vi.resetModules()` per test: the module holds a process-level cache, and a
 * test that inherited another test's cache would pass for the wrong reason.
 */

const ENV_KEYS = ['AI_KILL_SWITCH', 'AI_DAILY_BUDGET_USD', 'AI_USER_DAILY_BUDGET_USD'] as const;
let saved: Record<string, string | undefined> = {};

/** Rows the fake usage table returns, and whether reading it fails. */
let rows: Array<{ estimated_cost_usd: number }> = [];
let readError: { message: string } | null = null;
let selectCalls = 0;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      selectCalls += 1;
      const result = { data: readError ? null : rows, error: readError };
      const builder = {
        select: () => builder,
        gte: () => builder,
        eq: () => builder,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  rows = [];
  readError = null;
  selectCalls = 0;
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function load() {
  return import('@/lib/ai/budget');
}

describe('the kill switch', () => {
  it('refuses generation', async () => {
    process.env.AI_KILL_SWITCH = 'true';
    const { assertWithinBudget } = await load();
    await expect(assertWithinBudget({ userId: 'u1' })).rejects.toThrow(/temporarily disabled/i);
  });

  it('refuses WITHOUT reading the usage table', async () => {
    // The point of the switch: it is the one control that still works when the
    // database is the thing that is broken.
    process.env.AI_KILL_SWITCH = 'true';
    readError = { message: 'connection refused' };
    const { assertWithinBudget } = await load();
    await expect(assertWithinBudget({ userId: 'u1' })).rejects.toThrow();
    expect(selectCalls).toBe(0);
  });

  it('is off by default', async () => {
    const { assertWithinBudget } = await load();
    await expect(assertWithinBudget({ userId: 'u1' })).resolves.toBeUndefined();
  });
});

describe('the rolling budget', () => {
  it('allows a generation below the ceiling', async () => {
    process.env.AI_DAILY_BUDGET_USD = '10';
    rows = [{ estimated_cost_usd: 4 }];
    const { assertWithinBudget } = await load();
    await expect(assertWithinBudget()).resolves.toBeUndefined();
  });

  it('refuses at the ceiling', async () => {
    process.env.AI_DAILY_BUDGET_USD = '10';
    rows = [{ estimated_cost_usd: 6 }, { estimated_cost_usd: 4 }];
    const { assertWithinBudget } = await load();
    await expect(assertWithinBudget()).rejects.toThrow(/daily AI spending limit/i);
  });

  it('applies the per-user ceiling independently of the global one', async () => {
    process.env.AI_DAILY_BUDGET_USD = '1000';
    process.env.AI_USER_DAILY_BUDGET_USD = '3';
    rows = [{ estimated_cost_usd: 5 }];
    const { assertWithinBudget } = await load();
    // Global is nowhere near 1000, so a rejection can only come from the user cap.
    await expect(assertWithinBudget({ userId: 'u1' })).rejects.toThrow();
  });

  it('skips the user ceiling when there is no user', async () => {
    process.env.AI_DAILY_BUDGET_USD = '0';
    process.env.AI_USER_DAILY_BUDGET_USD = '1';
    rows = [{ estimated_cost_usd: 99 }];
    const { assertWithinBudget } = await load();
    await expect(assertWithinBudget()).resolves.toBeUndefined();
  });

  it('treats 0 as disabled rather than as an immediate refusal', async () => {
    // 0 must not mean "nothing may be spent" — an operator setting 0 is turning
    // the cap off, and reading it the other way bricks the product.
    process.env.AI_DAILY_BUDGET_USD = '0';
    process.env.AI_USER_DAILY_BUDGET_USD = '0';
    rows = [{ estimated_cost_usd: 1_000_000 }];
    const { assertWithinBudget } = await load();
    await expect(assertWithinBudget({ userId: 'u1' })).resolves.toBeUndefined();
  });

  it('falls back on an unparseable limit instead of throwing or disabling the cap', async () => {
    process.env.AI_DAILY_BUDGET_USD = 'twenty dollars';
    rows = [{ estimated_cost_usd: 24.99 }];
    const { assertWithinBudget } = await load();
    // Default is 25, and 24.99 is under it — so the default took effect rather
    // than the value becoming NaN (refuse everything) or Infinity (no cap).
    await expect(assertWithinBudget()).resolves.toBeUndefined();

    const { resetBudgetCache } = await load();
    resetBudgetCache();
    rows = [{ estimated_cost_usd: 25.01 }];
    await expect(assertWithinBudget()).rejects.toThrow();
  });
});

describe('when the usage table cannot be read', () => {
  it('fails open', async () => {
    process.env.AI_DAILY_BUDGET_USD = '1';
    readError = { message: 'relation "ai_usage_logs" does not exist' };
    const { assertWithinBudget } = await load();
    // A metrics outage must not become a product outage. The kill switch is
    // the control for the opposite preference, and it cannot fail to read.
    await expect(assertWithinBudget({ userId: 'u1' })).resolves.toBeUndefined();
  });
});

describe('the cache', () => {
  it('does not re-query within the window', async () => {
    process.env.AI_DAILY_BUDGET_USD = '100';
    rows = [{ estimated_cost_usd: 1 }];
    const { assertWithinBudget } = await load();
    await assertWithinBudget();
    await assertWithinBudget();
    await assertWithinBudget();
    expect(selectCalls).toBe(1);
  });

  it('counts spend recorded since the last read, without waiting for the window', async () => {
    process.env.AI_DAILY_BUDGET_USD = '10';
    rows = [{ estimated_cost_usd: 9 }];
    const { assertWithinBudget, recordSpend } = await load();

    await expect(assertWithinBudget()).resolves.toBeUndefined();
    recordSpend(2);
    // Still inside the cache window: without the fold-in this would pass, and
    // the cap would be enforced 15 seconds late.
    await expect(assertWithinBudget()).rejects.toThrow();
  });

  it('ignores a nonsensical spend rather than corrupting the total', async () => {
    process.env.AI_DAILY_BUDGET_USD = '10';
    rows = [{ estimated_cost_usd: 1 }];
    const { assertWithinBudget, recordSpend } = await load();
    await assertWithinBudget();
    recordSpend(Number.NaN);
    recordSpend(-500);
    await expect(assertWithinBudget()).resolves.toBeUndefined();
  });

  it('attributes recorded spend to the right user', async () => {
    process.env.AI_DAILY_BUDGET_USD = '0';
    process.env.AI_USER_DAILY_BUDGET_USD = '5';
    rows = [{ estimated_cost_usd: 4 }];
    const { assertWithinBudget, recordSpend } = await load();

    await assertWithinBudget({ userId: 'u1' });
    recordSpend(2, 'u1');

    await expect(assertWithinBudget({ userId: 'u1' })).rejects.toThrow();
    // u2 is a separate bucket and must be unaffected by u1's spend.
    await expect(assertWithinBudget({ userId: 'u2' })).resolves.toBeUndefined();
  });
});

describe('budgetStatus', () => {
  it('reports an absent user as null rather than as zero spend', async () => {
    rows = [{ estimated_cost_usd: 2 }];
    const { budgetStatus } = await load();
    const status = await budgetStatus();
    expect(status.userSpentUsd).toBeNull();
    expect(status.globalCapUsd).toBe(25);
  });
});
