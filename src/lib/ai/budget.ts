import 'server-only';
import { serverEnv } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

/**
 * Spend controls for AI generation.
 *
 * Every other limit in this product bounds *requests*: rate limits bound how
 * often, credits bound how many. Neither bounds money. A single generation
 * with a large input and a long output can cost more than a hundred cheap
 * ones, so a credit ceiling is not a cost ceiling — and the failures that
 * actually produce a surprise invoice (a retry loop, a stuck worker, a leaked
 * key) are precisely the ones that stay under every per-request limit while
 * running continuously.
 *
 * Two controls, in order of how much they can be relied on:
 *
 *   1. **The kill switch** (`AI_KILL_SWITCH`). One environment variable, no
 *      database, no arithmetic. It is the only control that still works when
 *      the thing going wrong is the database, and it takes effect on the next
 *      request rather than the next deploy.
 *   2. **Rolling 24-hour budgets**, global and per user, measured against
 *      `ai_usage_logs.estimated_cost_usd`.
 *
 * What the budget honestly is and is not:
 *
 *   - It is checked BEFORE a call, against the cost of calls already recorded.
 *     Concurrent calls in flight are not counted, so the ceiling can be
 *     overshot by roughly the cost of whatever is running at the moment it is
 *     crossed. It bounds the blast radius; it is not an accountant.
 *   - `estimated_cost_usd` is computed from the provider's published prices in
 *     `usage.ts`. If those drift, so does this. It is an estimate by name.
 *   - The global figure is cached in-process for a few seconds. On serverless
 *     that cache is per instance, so under high concurrency the effective
 *     ceiling is looser than the configured one. Making it exact would mean a
 *     synchronous aggregate on every generation, which costs latency on every
 *     request to catch a condition that occurs rarely — the wrong trade.
 *
 * Both caps are deliberately ON by default with real numbers. A cap that does
 * nothing until someone sets a variable protects only the deployments whose
 * operator already thought about it.
 */

export interface BudgetContext {
  userId?: string | null;
}

interface CachedSpend {
  usd: number;
  at: number;
}

/**
 * Short enough that a breach is noticed within seconds, long enough that a
 * burst of generations does not issue a burst of aggregate queries.
 */
const CACHE_MS = 15_000;

let globalCache: CachedSpend | null = null;
const userCache = new Map<string, CachedSpend>();

/** Exposed for tests; there is no production caller. */
export function resetBudgetCache(): void {
  globalCache = null;
  userCache.clear();
}

function windowStart(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

async function spendSince(column: 'user_id' | null, value: string | null): Promise<number> {
  const db = supabaseAdmin();
  let query = db.from('ai_usage_logs').select('estimated_cost_usd').gte('created_at', windowStart());
  if (column && value) query = query.eq(column, value);

  const { data, error } = await query;

  if (error) {
    /*
     * Fail OPEN, and say so loudly.
     *
     * The alternative — refusing every generation when the usage table is
     * unreadable — turns a metrics outage into a total product outage. The
     * kill switch exists for the case where someone decides money matters
     * more than availability, and unlike this path it cannot fail to read.
     */
    logger.error('ai_budget:unreadable', { message: error.message });
    return 0;
  }

  return (data ?? []).reduce((total, row) => total + Number(row.estimated_cost_usd ?? 0), 0);
}

async function cachedSpend(key: string | null): Promise<number> {
  const now = Date.now();

  if (key === null) {
    if (globalCache && now - globalCache.at < CACHE_MS) return globalCache.usd;
    const usd = await spendSince(null, null);
    globalCache = { usd, at: now };
    return usd;
  }

  const hit = userCache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.usd;
  const usd = await spendSince('user_id', key);
  userCache.set(key, { usd, at: now });

  /*
   * Bound the map. Without this it grows once per distinct user per instance
   * lifetime, which is a slow leak on a long-lived server — and the entries
   * are stale after 15 seconds anyway, so dropping the oldest costs one query.
   */
  if (userCache.size > 500) {
    const oldest = userCache.keys().next().value;
    if (oldest) userCache.delete(oldest);
  }

  return usd;
}

/**
 * Raises if this generation must not run. Called once at the top of the AI
 * entry point, so no route can opt out of it by accident.
 */
export async function assertWithinBudget(context: BudgetContext = {}): Promise<void> {
  if (serverEnv.aiKillSwitch) {
    logger.warn('ai_budget:kill_switch');
    throw ApiError.notConfigured(
      'AI generation is temporarily disabled on this deployment. No credits have been used.'
    );
  }

  const globalCap = serverEnv.aiDailyBudgetUsd;
  const userCap = serverEnv.aiUserDailyBudgetUsd;

  if (globalCap > 0) {
    const spent = await cachedSpend(null);
    if (spent >= globalCap) {
      logger.error('ai_budget:global_exceeded', { spent: round(spent), cap: globalCap });
      throw ApiError.notConfigured(
        'This deployment has reached its daily AI spending limit. Generation resumes within 24 hours, or the operator can raise the limit.'
      );
    }
  }

  if (userCap > 0 && context.userId) {
    const spent = await cachedSpend(context.userId);
    if (spent >= userCap) {
      logger.warn('ai_budget:user_exceeded', { spent: round(spent), cap: userCap });
      // A different error class: this one is about the caller, not the
      // deployment, and the caller can do something about it.
      throw ApiError.rateLimited(secondsUntilMidnightUtc());
    }
  }
}

/**
 * What a generation just cost, folded into the cache immediately.
 *
 * Without this, a burst inside one cache window sees a stale total and the cap
 * is only enforced 15 seconds late — which is exactly the window a runaway
 * loop needs. Recording optimistically means the cache can overcount slightly
 * if a call is also written to the table before the window expires; erring
 * toward the cap is the correct direction for a spending control.
 */
export function recordSpend(usd: number, userId?: string | null): void {
  if (!Number.isFinite(usd) || usd <= 0) return;

  const now = Date.now();
  if (globalCache) globalCache.usd += usd;
  else globalCache = { usd, at: now };

  if (userId) {
    const hit = userCache.get(userId);
    if (hit) hit.usd += usd;
    else userCache.set(userId, { usd, at: now });
  }
}

/** Current spend against both ceilings, for the admin panel and diagnostics. */
export async function budgetStatus(userId?: string | null): Promise<{
  killSwitch: boolean;
  globalSpentUsd: number;
  globalCapUsd: number;
  userSpentUsd: number | null;
  userCapUsd: number;
}> {
  const globalSpentUsd = serverEnv.aiDailyBudgetUsd > 0 ? await cachedSpend(null) : 0;
  return {
    killSwitch: serverEnv.aiKillSwitch,
    globalSpentUsd: round(globalSpentUsd),
    globalCapUsd: serverEnv.aiDailyBudgetUsd,
    // Null, not zero: no user asked about means unmeasured, not nothing spent.
    userSpentUsd: userId ? round(await cachedSpend(userId)) : null,
    userCapUsd: serverEnv.aiUserDailyBudgetUsd,
  };
}

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

/**
 * The rolling window is 24 hours from each call, not a calendar day, so there
 * is no single moment the budget resets. Midnight UTC is a defensible
 * approximation for a Retry-After and never overstates the wait by more than
 * a day.
 */
function secondsUntilMidnightUtc(): number {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.floor((midnight - now.getTime()) / 1000));
}
