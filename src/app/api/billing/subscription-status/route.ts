import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/*
 * Wrapped in `routeHandler` like every other JSON route.
 *
 * Unwrapped, `supabaseAdmin()` throwing MissingEnvError on a deployment with
 * no Supabase configured surfaced as a raw 500 — the wrapper is what maps it
 * to a 503 `not_configured`. Found by probing every route against a fresh
 * clone with no environment variables set.
 */
export const GET = routeHandler('/api/billing/subscription-status', async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  if (user.role === 'admin') {
    return NextResponse.json({
      plan: 'business',
      status: 'active',
      creditsRemaining: -1, // unlimited, bypassed entirely in canUseFeature
      isAdmin: true,
      features: PLANS.business.features,
    });
  }

  const supabase = supabaseAdmin();
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('plan, status, credits_remaining, renews_at')
    .eq('user_id', user.id)
    .maybeSingle();

  const plan: PlanId = (subscription?.plan as PlanId) ?? 'free';

  return NextResponse.json({
    plan,
    status: subscription?.status ?? 'active',
    creditsRemaining: subscription?.credits_remaining ?? PLANS.free.monthlyCredits,
    monthlyCredits: PLANS[plan].monthlyCredits,
    renewsAt: subscription?.renews_at ?? null,
    isAdmin: false,
    features: PLANS[plan].features,
  });
});
