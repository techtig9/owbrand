import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * Feature flags.
 *
 * The master command requires incomplete features to stay hidden behind flags,
 * and until now "behind a flag" meant an environment variable — which needs a
 * redeploy to change and cannot be varied per account. So a beta feature was
 * all-or-nothing, and turning one off during an incident meant a deploy at
 * exactly the moment deploys are riskiest.
 *
 * ## Failure behaviour, which is the whole design
 *
 * If the table cannot be read, every flag returns its **fallback**, and each
 * call site supplies one. The fallbacks are deliberately the *current shipped*
 * state, not `false`: a database blip must not silently turn off features that
 * work. A flag system that hides the product when it cannot reach the database
 * has converted a metrics problem into an outage.
 *
 * ## Why not percentage rollouts
 *
 * A percentage that rehashes per request moves users in and out of a feature
 * between page loads, and "it worked a minute ago" costs more to debug than
 * the feature is worth at this scale. `enabled_for` holds explicit user ids,
 * which is stable and auditable. A percentage can be added when there are
 * enough users for it to mean anything.
 */

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  enabled_for: string[];
  updated_at: string;
}

interface Cached {
  flags: Map<string, FeatureFlag>;
  at: number;
}

/**
 * Short enough that turning a flag off takes effect within a minute — which is
 * the point of having flags at all — and long enough that a busy page does not
 * issue a query per component.
 */
const CACHE_MS = 30_000;

let cache: Cached | null = null;

/** Exposed for tests. No production caller. */
export function resetFlagCache(): void {
  cache = null;
}

async function loadFlags(): Promise<Map<string, FeatureFlag>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.flags;

  const { data, error } = await supabaseAdmin()
    .from('feature_flags')
    .select('key, description, enabled, enabled_for, updated_at');

  if (error) {
    logger.error('flags:unreadable', { message: error.message });
    // An empty map, so every lookup falls back. See the header.
    return new Map();
  }

  const flags = new Map((data ?? []).map((row) => [row.key, row as FeatureFlag]));
  cache = { flags, at: Date.now() };
  return flags;
}

/**
 * Whether a feature is on for a given user.
 *
 * `fallback` is required rather than defaulting to false, so every call site
 * has to state what should happen when flags are unavailable. A default of
 * false would mean a database blip hides working features, and defaults are
 * where that decision gets made by accident.
 */
export async function isEnabled(
  key: string,
  options: { userId?: string | null; fallback: boolean }
): Promise<boolean> {
  const flags = await loadFlags();
  const flag = flags.get(key);

  // An unknown key is not an error: a flag referenced before it is seeded
  // should behave as its fallback rather than throwing in a render.
  if (!flag) return options.fallback;

  // A targeted user sees the feature even when it is globally off. That is the
  // direction that matters: it lets a beta run for named accounts without
  // exposing it to everyone.
  if (options.userId && flag.enabled_for?.includes(options.userId)) return true;

  return flag.enabled;
}

/** Every flag, for the admin screen. Ordered so the list does not reshuffle. */
export async function allFlags(): Promise<FeatureFlag[]> {
  const flags = await loadFlags();
  return [...flags.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function setFlag(input: {
  key: string;
  enabled: boolean;
  adminId: string;
}): Promise<boolean> {
  const db = supabaseAdmin();

  const { error } = await db
    .from('feature_flags')
    .update({ enabled: input.enabled, updated_by: input.adminId, updated_at: new Date().toISOString() })
    .eq('key', input.key);

  if (error) {
    logger.error('flags:update_failed', { key: input.key, message: error.message });
    return false;
  }

  await db.from('audit_logs').insert({
    actor_id: input.adminId,
    actor_type: 'admin',
    action: 'flag.changed',
    entity_type: 'feature_flag',
    entity_id: input.key,
    metadata: { enabled: input.enabled },
  });

  // Invalidated immediately rather than waiting for the window. An admin who
  // turns a flag off during an incident and watches it stay on for 30 seconds
  // will turn it off again, and then a third time.
  resetFlagCache();
  return true;
}
