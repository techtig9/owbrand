import { supabaseAdmin } from '@/lib/supabase/admin';

/** Live payment data — never prerendered. See src/app/admin/page.tsx. */
export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-mint-100 text-ink',
  failed: 'bg-blush-100 text-ink',
};

export default async function AdminPaymentsPage() {
  const supabase = supabaseAdmin();
  const { data: payments } = await supabase
    .from('payments')
    .select('id, paddle_transaction_id, amount, status, created_at, users(email, name)')
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">Payments</h1>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Transaction</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {(payments ?? []).map((p: any) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">{p.users?.email}</td>
                <td className="px-5 py-3 text-ink-faint">{p.paddle_transaction_id}</td>
                <td className="px-5 py-3 text-ink-soft">${Number(p.amount).toFixed(2)}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? 'bg-canvas-alt text-ink-soft'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-ink-faint">{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
