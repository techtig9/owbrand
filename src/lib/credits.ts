import { PLANS } from '@/lib/plans';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { FeatureAction, PlanId } from '@/types';

/** Credit cost per action. "Free" actions (0) still pass through gating for plan-feature checks. */
export const CREDIT_COSTS: Record<FeatureAction, number> = {
  generate_website: 2500,
  generate_website_from_url: 3000,
  regenerate_website: 750,
  generate_landing_page: 750,
  generate_page: 500,
  generate_section: 200,
  ai_edit: 350,
  change_theme: 100,
  generate_logo: 300,
  generate_photo: 150,
  generate_post: 150,
  generate_content: 100,
  generate_reel: 600,
  schedule_post: 0,
  voice_prompt: 50,
  export_code: 0,
  deploy: 0,
  build_brand: 500,
  generate_video: 900,
  create_campaign: 300,
};

/** Which plan-level feature flag (if any) gates an action, beyond the raw credit cost. */
const ACTION_FEATURE_FLAG: Partial<Record<FeatureAction, keyof (typeof PLANS)['free']['features']>> = {
  generate_website_from_url: 'generateFromUrl',
  ai_edit: 'aiWebsiteEditing',
  generate_logo: 'contentStudio',
  generate_photo: 'contentStudio',
  generate_post: 'contentStudio',
  generate_content: 'contentStudio',
  generate_reel: 'reelsGenerator',
  schedule_post: 'autoPostScheduler',
  voice_prompt: 'voiceAssistant',
  export_code: 'zipExport',
};

export interface GateResult {
  allowed: boolean;
  reason?: string;
  creditCost: number;
  creditsRemainingAfter?: number;
}

interface GateableUser {
  id: string;
  role: 'user' | 'admin';
}

/**
 * Single shared entry point for every AI-generation, content-studio, scheduling,
 * export, and deployment route. Mirrors the spec's `canUseFeature(user, action)`.
 *
 * 1. Admins always pass, no credit deduction.
 * 2. Otherwise look up the active plan + credit balance from Subscriptions.
 * 3. Check the plan-level feature flag (if the action has one) and the credit balance.
 * 4. On success, atomically deduct credits via a Postgres RPC (see supabase/schema.sql,
 *    `deduct_credits`) so concurrent requests can't double-spend the same balance.
 *
 * Failed generations must call `refundCredits` (below) to roll the deduction back —
 * per the spec, failed requests should consume 0 credits.
 */
export async function canUseFeature(user: GateableUser, action: FeatureAction): Promise<GateResult> {
  const creditCost = CREDIT_COSTS[action];

  if (user.role === 'admin') {
    return { allowed: true, creditCost: 0 };
  }

  const supabase = supabaseAdmin();
  const { data: subscription, error } = await supabase
    .from('subscriptions')
    .select('plan, status, credits_remaining')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return { allowed: false, reason: 'Could not verify your subscription. Please try again.', creditCost };
  }

  const plan: PlanId = (subscription?.plan as PlanId) ?? 'free';
  const planDef = PLANS[plan];
  const creditsRemaining = subscription?.credits_remaining ?? planDef.monthlyCredits;

  if (subscription?.status && !['active', 'trialing'].includes(subscription.status)) {
    return {
      allowed: false,
      reason: 'Your subscription is not active. Update billing to keep using paid features.',
      creditCost,
    };
  }

  const requiredFlag = ACTION_FEATURE_FLAG[action];
  if (requiredFlag && !planDef.features[requiredFlag]) {
    return {
      allowed: false,
      reason: `This feature isn't available on the ${planDef.label} plan. Upgrade to unlock it.`,
      creditCost,
    };
  }

  if (creditsRemaining < creditCost) {
    return {
      allowed: false,
      reason: `Not enough credits (need ${creditCost}, have ${creditsRemaining}). Upgrade your plan or wait for renewal.`,
      creditCost,
    };
  }

  if (creditCost > 0) {
    const { data: newBalance, error: deductError } = await supabase.rpc('deduct_credits', {
      p_user_id: user.id,
      p_amount: creditCost,
    });
    if (deductError) {
      return { allowed: false, reason: 'Could not reserve credits for this action. Please try again.', creditCost };
    }
    return { allowed: true, creditCost, creditsRemainingAfter: newBalance as number };
  }

  return { allowed: true, creditCost, creditsRemainingAfter: creditsRemaining };
}

/** Call when a gated action fails after credits were deducted, so the user isn't charged. */
export async function refundCredits(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const supabase = supabaseAdmin();
  await supabase.rpc('refund_credits', { p_user_id: userId, p_amount: amount });
}
