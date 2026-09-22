import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Unit economics.
 *
 * The question this answers is the one that decides whether the business
 * works: **does a customer on each plan cost less in AI than they pay?**
 *
 * It is computed from `ai_usage_logs.estimated_cost_usd` — the same figure the
 * budget cap reads — rather than from an assumed cost per generation. An
 * assumed number tells you what you hoped; the logged number tells you what
 * happened, and the two diverge the moment a prompt grows or a model changes
 * price.
 *
 * Two honesty rules run through this file:
 *
 *  1. **A plan with no active users reports null margin, never 100%.** Zero
 *     cost across zero users is not a healthy margin, it is no data, and a
 *     dashboard that renders it as a green 100% is actively misleading about
 *     the plan you are about to price a launch around.
 *  2. **Costs are estimates and say so.** `estimated_cost_usd` comes from the
 *     providers' published prices in `lib/ai/usage.ts`. If those drift, this
 *     drifts. It is close enough to decide pricing and not close enough to
 *     reconcile an invoice.
 */

export interface PlanEconomics {
  plan: string;
  /** Monthly price in USD. Null where the plan is free or unpriced. */
  priceUsd: number | null;
  activeUsers: number;
  /** Total estimated AI spend by users on this plan over the window. */
  totalCostUsd: number;
  /** Null when there are no users — not zero, and not 100% margin. */
  costPerUserUsd: number | null;
  /** Gross margin as a fraction. Null when unmeasurable. */
  margin: number | null;
  /** True when this plan costs more than it charges. */
  negative: boolean;
}

export interface EconomicsReport {
  windowDays: number;
  generatedAt: string;
  plans: PlanEconomics[];
  totalCostUsd: number;
  /** Plans currently losing money, so a caller does not have to filter. */
  lossMaking: string[];
  caveat: string;
}

/**
 * List prices, in one place.
 *
 * Deliberately NOT read from Paddle at runtime. This is an internal analysis
 * that has to work on a deployment with no Paddle key, and a report that
 * silently produces no margins because billing is unconfigured is a report
 * nobody can use. When these change, change them here — and the drift between
 * this and Paddle is itself worth checking, which is why the numbers are
 * visible rather than hidden behind an API call.
 */
const PLAN_PRICE_USD: Record<string, number | null> = {
  free: null,
  starter: 29,
  pro: 79,
  business: 199,
};

const CAVEAT =
  'Costs are estimates derived from providers’ published per-token prices, not from invoices. Accurate enough to price a plan; not accurate enough to reconcile a bill.';

export async function computeEconomics(windowDays = 30): Promise<EconomicsReport> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const [subscriptions, usage] = await Promise.all([
    db.from('subscriptions').select('user_id, plan, status'),
    db.from('ai_usage_logs').select('user_id, estimated_cost_usd').gte('created_at', since),
  ]);

  const planByUser = new Map<string, string>();
  const usersByPlan = new Map<string, Set<string>>();

  for (const row of subscriptions.data ?? []) {
    if (row.status !== 'active' || !row.user_id) continue;
    const plan = String(row.plan);
    planByUser.set(row.user_id, plan);
    (usersByPlan.get(plan) ?? usersByPlan.set(plan, new Set()).get(plan)!).add(row.user_id);
  }

  const costByPlan = new Map<string, number>();
  let totalCostUsd = 0;

  for (const row of usage.data ?? []) {
    const cost = Number(row.estimated_cost_usd ?? 0);
    totalCostUsd += cost;
    /*
     * Usage from a deleted user has a null user_id (the FK is `set null`, so
     * the row survives the account). It is counted in the total — the money was
     * genuinely spent — but attributed to no plan, because attributing it to
     * one would overstate that plan's cost per user.
     */
    const plan = row.user_id ? planByUser.get(row.user_id) : undefined;
    if (plan) costByPlan.set(plan, (costByPlan.get(plan) ?? 0) + cost);
  }

  const plans: PlanEconomics[] = Object.keys(PLAN_PRICE_USD).map((plan) => {
    const activeUsers = usersByPlan.get(plan)?.size ?? 0;
    const planCost = costByPlan.get(plan) ?? 0;
    const priceUsd = PLAN_PRICE_USD[plan] ?? null;

    // Null, not zero. See the header: no users is no data, not a perfect margin.
    const costPerUserUsd = activeUsers > 0 ? planCost / activeUsers : null;

    const margin =
      priceUsd !== null && priceUsd > 0 && costPerUserUsd !== null
        ? (priceUsd - costPerUserUsd) / priceUsd
        : null;

    return {
      plan,
      priceUsd,
      activeUsers,
      totalCostUsd: round(planCost),
      costPerUserUsd: costPerUserUsd === null ? null : round(costPerUserUsd),
      margin: margin === null ? null : Math.round(margin * 1000) / 1000,
      // A free plan is not "loss-making" — it has no price to lose against, and
      // flagging it would bury the paid plan that genuinely is.
      negative: margin !== null && margin < 0,
    };
  });

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    plans,
    totalCostUsd: round(totalCostUsd),
    lossMaking: plans.filter((plan) => plan.negative).map((plan) => plan.plan),
    caveat: CAVEAT,
  };
}

/**
 * The free plan's cost, which is the number that decides whether a free tier
 * is a growth channel or a leak.
 *
 * Kept separate from margin because a free plan has no margin by definition —
 * the meaningful figure is what it costs per free user per month, compared
 * against the conversion rate needed for that to pay for itself.
 */
export function freeTierBurn(report: EconomicsReport): {
  costPerFreeUserUsd: number | null;
  monthlyBurnUsd: number;
  /** Conversion to the cheapest paid plan needed to break even on the free tier. */
  breakEvenConversionRate: number | null;
} {
  const free = report.plans.find((plan) => plan.plan === 'free');
  const cheapestPaid = report.plans
    .filter((plan) => plan.priceUsd !== null && plan.priceUsd > 0)
    .sort((a, b) => (a.priceUsd ?? 0) - (b.priceUsd ?? 0))[0];

  if (!free || free.costPerUserUsd === null || !cheapestPaid?.priceUsd) {
    return { costPerFreeUserUsd: free?.costPerUserUsd ?? null, monthlyBurnUsd: free?.totalCostUsd ?? 0, breakEvenConversionRate: null };
  }

  return {
    costPerFreeUserUsd: free.costPerUserUsd,
    monthlyBurnUsd: free.totalCostUsd,
    // What fraction of free users must convert for the paid revenue to cover
    // what the free tier costs to run.
    breakEvenConversionRate: Math.round((free.costPerUserUsd / cheapestPaid.priceUsd) * 10_000) / 10_000,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
