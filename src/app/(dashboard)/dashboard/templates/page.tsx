import { supabaseAdmin } from '@/lib/supabase/admin';

export default async function TemplatesPage() {
  const supabase = supabaseAdmin();
  const { data: templates } = await supabase.from('templates').select('id, category, name').order('category');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Templates</h1>
        <p className="mt-1 text-sm text-ink-soft">Your plan&rsquo;s available count is shown on the Billing page.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(templates ?? []).map((t) => (
          <div key={t.id} className="rounded-2xl border border-line bg-white p-4">
            <div className="h-20 rounded-xl bg-mint-50" />
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-faint">{t.category}</p>
            <p className="text-sm font-semibold text-ink">{t.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
