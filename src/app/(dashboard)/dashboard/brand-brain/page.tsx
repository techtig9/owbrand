import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export default async function BrandBrainPage() {
  const user = await getCurrentUser();
  const db = supabaseAdmin();
  const { data: brand } = await db
    .from('brands')
    .select('*')
    .eq('user_id', user!.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  const { data: profile } = brand
    ? await db.from('brand_profiles').select('*').eq('brand_id', brand.id).maybeSingle()
    : { data: null };
  const { data: guidelines } = brand
    ? await db.from('brand_guidelines').select('*').eq('brand_id', brand.id).maybeSingle()
    : { data: null };
  const { data: rules } = brand
    ? await db.from('brand_rules').select('*').eq('brand_id', brand.id).limit(12)
    : { data: [] };
  if (!brand)
    return (
      <div className="glass-panel p-8">
        <h1 className="font-display text-2xl font-bold">Brand Brain</h1>
        <p className="mt-2 text-sm text-content-secondary">
          Create your first brand from AI Generator to initialize the Brand Brain.
        </p>
      </div>
    );
  const audience = profile?.target_audience as any;
  const positioning = profile?.positioning as any;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="section-eyebrow">AI operating system</p>
        <h1 className="mt-3 font-display text-3xl font-bold">{brand.name} Brand Brain</h1>
        <p className="mt-1 text-sm text-content-secondary">One source of truth used by every OwBrand AI workflow.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="glass-panel p-6 lg:col-span-2">
          <h2 className="font-display text-lg font-semibold">Positioning</h2>
          <p className="mt-3 text-sm leading-6 text-content-secondary">
            {positioning?.usp || 'Add your unique selling proposition.'}
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-content-tertiary">Industry</p>
              <p className="mt-1 text-sm font-medium">{profile?.industry || '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-content-tertiary">Voice</p>
              <p className="mt-1 text-sm font-medium">{profile?.voice || '—'}</p>
            </div>
          </div>
        </section>
        <section className="glass-panel p-6">
          <h2 className="font-display text-lg font-semibold">Audience</h2>
          <p className="mt-3 text-sm text-content-secondary">
            {audience?.personas?.[0]?.name || audience?.personas?.[0] || 'Primary customer'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(profile?.personality || []).map((x: string) => (
              <span key={x} className="rounded-full bg-surface-raised px-3 py-1 text-xs">
                {x}
              </span>
            ))}
          </div>
        </section>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="glass-panel p-6">
          <h2 className="font-display text-lg font-semibold">Visual identity</h2>
          <div className="mt-5 flex flex-wrap gap-3">
            {(brand.brand_colors || []).map((c: string) => (
              <div
                key={c}
                className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2"
              >
                <span className="h-6 w-6 rounded-lg border" style={{ backgroundColor: c }} />
                <span className="text-xs">{c}</span>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-content-tertiary">Fonts</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {brand.brand_fonts?.map((f: string) => (
              <span key={f} className="rounded-full bg-surface-raised px-3 py-1 text-xs">
                {f}
              </span>
            ))}
          </div>
        </section>
        <section className="glass-panel p-6">
          <h2 className="font-display text-lg font-semibold">Brand rules</h2>
          <div className="mt-4 space-y-2">
            {(rules || []).map((r: any) => (
              <div key={r.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
                <span className="mr-2 text-[10px] font-bold uppercase text-primary">{r.type}</span>
                {r.rule}
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="glass-panel p-6">
        <h2 className="font-display text-lg font-semibold">Guidelines</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase text-content-tertiary">Preferred words</p>
            <p className="mt-2 text-sm text-content-secondary">
              {(guidelines?.preferred_words || []).join(', ') || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-content-tertiary">Avoided words</p>
            <p className="mt-2 text-sm text-content-secondary">
              {(guidelines?.avoided_words || []).join(', ') || '—'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
