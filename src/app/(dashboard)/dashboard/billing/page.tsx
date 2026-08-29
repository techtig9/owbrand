import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';
import { PlanGrid } from '@/components/dashboard/PlanGrid';
import { PaddleInit } from '@/components/dashboard/PaddleInit';
import { StatCard } from '@/components/dashboard/shared';

export default async function BillingPage() {
  const user = await getCurrentUser();

  if (user!.role === 'admin') {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold text-ink">Billing</h1>
        <div className="rounded-2xl border border-line bg-white p-6 text-sm text-ink-soft">
          Admin accounts get full Business-tier access with unlimited credits — no billing required.
        </div>
      </div>
    );
  }

  const supabase = supabaseAdmin();
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('plan, status, credits_remaining, renews_at')
    .eq('user_id', user!.id)
    .maybeSingle();

  const plan: PlanId = (subscription?.plan as PlanId) ?? 'free';
  const planDef = PLANS[plan];

  return (
    <div className="space-y-8">
      <PaddleInit />
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Billing</h1>
        <p className="mt-1 text-sm text-ink-soft">Manage your plan, credits, and payment history.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Current plan" value={planDef.label} hint={subscription?.status ?? 'active'} />
        <StatCard label="Credits remaining" value={(subscription?.credits_remaining ?? planDef.monthlyCredits).toLocaleString()} />
        <StatCard
          label="Renews"
          value={subscription?.renews_at ? new Date(subscription.renews_at).toLocaleDateString() : '—'}
        />
      </div>

      <div>
        <h2 className="mb-4 font-display text-lg font-semibold text-ink">Upgrade</h2>
        <PlanGrid currentPlan={plan} />
      </div>
    </div>
  );
}
