import { supabaseAdmin } from '@/lib/supabase/admin';
import { StatCard } from '@/components/dashboard/shared';

export default async function AdminOverviewPage() {
  const supabase = supabaseAdmin();

  const [{ count: userCount }, { data: subs }, { data: payments }, { count: assetCount }] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('subscriptions').select('plan, status'),
    supabase.from('payments').select('amount, status'),
    supabase.from('content_assets').select('id', { count: 'exact', head: true }),
  ]);

  const activeByPlan = (subs ?? []).reduce<Record<string, number>>((acc, s) => {
    if (s.status === 'active') acc[s.plan] = (acc[s.plan] ?? 0) + 1;
    return acc;
  }, {});

  const revenue = (payments ?? [])
    .filter((p) => p.status === 'completed')
    .reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-bold text-ink">Overview</h1>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Total users" value={String(userCount ?? 0)} />
        <StatCard label="Revenue (approx.)" value={`$${revenue.toFixed(2)}`} />
        <StatCard label="Content assets generated" value={String(assetCount ?? 0)} />
        <StatCard label="Active paid subs" value={String(Object.values(activeByPlan).reduce((a, b) => a + b, 0))} />
      </div>

      <div className="rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Active subscriptions by plan</h2>
        <div className="mt-4 space-y-2">
          {['starter', 'pro', 'business'].map((plan) => (
            <div key={plan} className="flex items-center justify-between text-sm">
              <span className="capitalize text-ink-soft">{plan}</span>
              <span className="font-medium text-ink">{activeByPlan[plan] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
