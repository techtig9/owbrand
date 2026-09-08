import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { EmptyState } from '@/components/dashboard/shared';

export default async function BrandKitPage({ searchParams }: { searchParams: { brand?: string } }) {
  const user = await getCurrentUser();
  const supabase = supabaseAdmin();

  const query = supabase.from('brands').select('*').eq('user_id', user!.id);
  const { data: brand } = searchParams.brand
    ? await query.eq('id', searchParams.brand).maybeSingle()
    : await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (!brand) {
    return (
      <EmptyState title="No brand kit yet" body="Generate a brand in the AI Generator first — its identity assets will show up here." />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{brand.name}</h1>
        <p className="mt-1 text-sm text-content-secondary">{brand.description}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-display text-sm font-semibold text-ink">Logo</h2>
          <div className="mt-4 flex h-32 items-center justify-center rounded-xl bg-surface-raised">
            {brand.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt={`${brand.name} logo`} className="max-h-20" />
            ) : (
              <span className="text-xs text-content-tertiary">Generate a logo in the Content Studio</span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-display text-sm font-semibold text-ink">Colors</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {brand.brand_colors?.length ? (
              brand.brand_colors.map((color: string) => (
                <div key={color} className="text-center">
                  <div className="h-12 w-12 rounded-full border border-line" style={{ backgroundColor: color }} />
                  <p className="mt-1 text-[10px] text-content-tertiary">{color}</p>
                </div>
              ))
            ) : (
              <span className="text-xs text-content-tertiary">No palette generated yet</span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 lg:col-span-2">
          <h2 className="font-display text-sm font-semibold text-ink">Fonts</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {brand.brand_fonts?.length ? (
              brand.brand_fonts.map((font: string) => (
                <span key={font} className="rounded-full border border-line bg-surface-raised px-3 py-1 text-xs text-content-secondary">
                  {font}
                </span>
              ))
            ) : (
              <span className="text-xs text-content-tertiary">No fonts generated yet</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
