/**
 * Approval-policy persistence.
 *
 * Both /api/marketing/approval and /api/marketing/execute previously accepted
 * the automation policy from the request body, defaulting to
 * DEFAULT_APPROVAL_POLICY when absent. Combined with the fact that neither
 * route was authenticated, that meant an anonymous caller could declare
 * `autonomous` with `autoSpendMoney: true` and be told every action was
 * permitted.
 *
 * The policy is a server-side fact about a brand. It lives here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_APPROVAL_POLICY, type ApprovalPolicy, type AutomationLevel } from '@/lib/marketing/approval';

type Db = SupabaseClient<any, any, any>;

const VALID_LEVELS: AutomationLevel[] = ['manual', 'assisted', 'autonomous'];

/**
 * Reads a brand's stored automation policy.
 *
 * Falls back to DEFAULT_APPROVAL_POLICY (assisted, no auto-publish, no
 * auto-spend) when no row exists — the safe direction. An unrecognised stored
 * level also degrades to the default rather than being trusted.
 */
export async function loadApprovalPolicy(brandId: string, db: Db = supabaseAdmin()): Promise<ApprovalPolicy> {
  const { data } = await db
    .from('approval_policies')
    .select('automation_level, auto_publish, auto_create_ads, auto_spend_money')
    .eq('brand_id', brandId)
    .maybeSingle();

  if (!data) return DEFAULT_APPROVAL_POLICY;

  const row = data as {
    automation_level: string | null;
    auto_publish: boolean | null;
    auto_create_ads: boolean | null;
    auto_spend_money: boolean | null;
  };

  const level = VALID_LEVELS.includes(row.automation_level as AutomationLevel)
    ? (row.automation_level as AutomationLevel)
    : DEFAULT_APPROVAL_POLICY.level;

  return {
    level,
    autoPublish: row.auto_publish ?? false,
    autoCreateAds: row.auto_create_ads ?? DEFAULT_APPROVAL_POLICY.autoCreateAds,
    autoSpendMoney: row.auto_spend_money ?? false,
  };
}

/**
 * Writes a brand's automation policy. Only reachable from a route that has
 * already authorized the caller against the brand.
 */
export async function saveApprovalPolicy(
  brandId: string,
  policy: Partial<ApprovalPolicy>,
  db: Db = supabaseAdmin()
): Promise<ApprovalPolicy> {
  const current = await loadApprovalPolicy(brandId, db);
  const next: ApprovalPolicy = {
    level: policy.level && VALID_LEVELS.includes(policy.level) ? policy.level : current.level,
    autoPublish: policy.autoPublish ?? current.autoPublish,
    autoCreateAds: policy.autoCreateAds ?? current.autoCreateAds,
    autoSpendMoney: policy.autoSpendMoney ?? current.autoSpendMoney,
  };

  const { error } = await db.from('approval_policies').upsert(
    {
      brand_id: brandId,
      automation_level: next.level,
      auto_publish: next.autoPublish,
      auto_create_ads: next.autoCreateAds,
      auto_spend_money: next.autoSpendMoney,
    },
    { onConflict: 'brand_id' }
  );

  if (error) throw error;
  return next;
}
