import Link from 'next/link';
import { Palette, Sparkles } from 'lucide-react';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { Button, Card, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/dashboard/shared';

export const dynamic = 'force-dynamic';

export default async function BrandKitPage({ searchParams }: { searchParams: { brand?: string } }) {
  const user = await getCurrentUser();
  const supabase = supabaseAdmin();

  /*
   * Scoped through accessibleBrandIds rather than `.eq('user_id', user.id)`.
   *
   * The previous query only ever matched brands the viewer personally created,
   * so a brand shared with them through a workspace was invisible here while
   * being visible on every other screen — the page reported "no brand kit yet"
   * for a brand that plainly existed.
   */
  const brandIds = await accessibleBrandIds(user!.id, supabase);

  const brand = brandIds.length
    ? (
        await (searchParams.brand && brandIds.includes(searchParams.brand)
          ? supabase.from('brands').select('*').eq('id', searchParams.brand).maybeSingle()
          : supabase
              .from('brands')
              .select('*')
              .in('id', brandIds)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle())
      ).data
    : null;

  if (!brand) {
    return (
      <EmptyState
        icon={<Palette className="h-5 w-5" />}
        title="No brand kit yet"
        body="A brand kit is generated from your Brand Brain — build one and its logo, palette and fonts appear here."
        // `action` is required by EmptyState, and this page is why. It
        // previously rendered "Generate a brand in the AI Generator first" with
        // no link, so the instruction named a destination the reader then had
        // to go and find.
        action={
          <Link href="/dashboard/ai-generator">
            <Button icon={<Sparkles className="h-4 w-4" />}>Build a brand</Button>
          </Link>
        }
      />
    );
  }

  const colors: string[] = brand.brand_colors ?? [];
  const fonts: string[] = brand.brand_fonts ?? [];

  return (
    <div className="space-y-8">
      <PageHeader title={brand.name} description={brand.description ?? undefined} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-content">Logo</h2>
          <div className="mt-4 flex h-32 items-center justify-center rounded-md bg-surface-raised">
            {brand.logo_url ? (
              /*
               * Raw <img>: remote, already sized, and often a signed URL whose
               * signature rotates. See products/page.tsx for the full reasoning.
               *
               * The directive below must stay on its own single line —
               * eslint-disable-next-line applies to the very next line, so an
               * explanation wrapped onto a second comment line silently
               * disables the comment instead of the JSX.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt={`${brand.name} logo`} className="max-h-20" loading="lazy" />
            ) : (
              <p className="px-4 text-center text-xs text-content-tertiary">
                No logo yet.{' '}
                <Link href="/dashboard/content-studio" className="font-medium text-primary underline">
                  Generate one in the Creative Studio
                </Link>
                .
              </p>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-content">Colours</h2>
          {colors.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-3">
              {colors.map((color) => (
                <li key={color} className="text-center">
                  <span
                    className="block h-12 w-12 rounded-full border border-[color:var(--color-border)]"
                    style={{ backgroundColor: color }}
                    // The swatch is decorative: the hex below is the content,
                    // so the colour is never the only way to read the value.
                    aria-hidden="true"
                  />
                  <span className="mt-1 block text-[10px] tabular-nums text-content-tertiary">{color}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-xs text-content-tertiary">No palette generated yet.</p>
          )}
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold text-content">Fonts</h2>
          {fonts.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {fonts.map((font) => (
                <li
                  key={font}
                  className="rounded-full border border-[color:var(--color-border)] bg-surface-raised px-3 py-1 text-xs text-content-secondary"
                >
                  {font}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-xs text-content-tertiary">No fonts generated yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
