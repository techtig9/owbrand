import { supabaseAdmin } from '@/lib/supabase/admin';
import { SubscriptionActions } from '@/components/admin/SubscriptionActions';

export default async function AdminSubscriptionsPage() {
  const supabase = supabaseAdmin();
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan, status, credits_remaining, renews_at, users(email, name)')
    .order('renews_at', { ascending: true });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">Subscriptions</h1>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Credits</th>
              <th className="px-5 py-3 font-medium">Renews</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(subs ?? []).map((s: any) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">{s.users?.email}</td>
                <td className="px-5 py-3 capitalize text-ink-soft">{s.plan}</td>
                <td className="px-5 py-3 text-ink-soft">{s.status}</td>
                <td className="px-5 py-3 text-ink-soft">{s.credits_remaining}</td>
                <td className="px-5 py-3 text-ink-faint">{s.renews_at ? new Date(s.renews_at).toLocaleDateString() : '—'}</td>
                <td className="px-5 py-3">
                  <SubscriptionActions userId={s.user_id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
