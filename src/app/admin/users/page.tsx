import { supabaseAdmin } from '@/lib/supabase/admin';

/** Live user data — never prerendered. See src/app/admin/page.tsx. */
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const supabase = supabaseAdmin();
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email, role, created_at, subscriptions(plan, credits_remaining, status)')
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">Users</h1>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-raised text-xs uppercase tracking-wide text-content-tertiary">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Credits</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Signed up</th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u: any) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">{u.name}</td>
                <td className="px-5 py-3 text-content-secondary">{u.email}</td>
                <td className="px-5 py-3 capitalize text-content-secondary">{u.subscriptions?.[0]?.plan ?? 'free'}</td>
                <td className="px-5 py-3 text-content-secondary">{u.subscriptions?.[0]?.credits_remaining ?? '—'}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.role === 'admin' ? 'bg-primary text-primary-fg' : 'bg-surface-raised text-content-secondary'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-5 py-3 text-content-tertiary">{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
