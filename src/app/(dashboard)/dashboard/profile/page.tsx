import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const supabase = supabaseAdmin();

  const [{ data: subscription }, { data: accounts }] = await Promise.all([
    supabase.from('subscriptions').select('plan').eq('user_id', user!.id).maybeSingle(),
    supabase.from('social_accounts').select('platform').eq('user_id', user!.id),
  ]);

  const plan: PlanId = user!.role === 'admin' ? 'business' : (subscription?.plan as PlanId) ?? 'free';

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-display text-2xl font-bold text-ink">Profile</h1>

      <div className="mt-6 rounded-2xl border border-line bg-white p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blush-100 font-display text-xl font-bold text-ink">
            {user!.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="font-display text-lg font-semibold text-ink">{user!.name}</p>
            <p className="text-sm text-ink-soft">{user!.email}</p>
          </div>
        </div>

        <dl className="mt-6 space-y-3 border-t border-line pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Plan</dt>
            <dd className="font-medium text-ink">{PLANS[plan].label}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Role</dt>
            <dd className="font-medium capitalize text-ink">{user!.role}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Connected accounts</dt>
            <dd className="font-medium text-ink">{accounts?.length ?? 0}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
