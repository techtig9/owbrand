import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { WebsiteBuilder } from '@/components/website/WebsiteBuilder';
import { EmptyState } from '@/components/dashboard/shared';

export const dynamic = 'force-dynamic';

/**
 * The Website screen.
 *
 * Replaces the raw-JSON preview the master command specifically called out.
 * The brand is resolved server-side from the caller's accessible set, so a
 * brandId in the query string cannot reach another tenant's site.
 */
export default async function WebsitePage({ searchParams }: { searchParams: { brand?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = supabaseAdmin();
  const accessible = await accessibleBrandIds(user.id, db);

  if (accessible.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Header />
        <EmptyState
          title="No brand yet"
          body="Build a Brand Brain first — your website is generated from it."
          action={
            <Link href="/dashboard/ai-generator" className="btn-primary">
              Build my brand
            </Link>
          }
        />
      </div>
    );
  }

  // Honour ?brand only when the caller actually has access to it.
  const requested = searchParams.brand;
  const brandId = requested && accessible.includes(requested) ? requested : accessible[0];

  const { data: brands } = await db
    .from('brands')
    .select('id, name')
    .in('id', accessible)
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <Header>
        {(brands?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-2">
            {(brands ?? []).map((brand: { id: string; name: string }) => (
              <Link
                key={brand.id}
                href={`/dashboard/website?brand=${brand.id}`}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${
                  brand.id === brandId ? 'bg-ink text-canvas' : 'border border-line text-content-secondary'
                }`}
              >
                {brand.name}
              </Link>
            ))}
          </div>
        )}
      </Header>

      <WebsiteBuilder brandId={brandId} />
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="section-eyebrow">Website</p>
        <h1 className="mt-3 font-display text-3xl font-bold">Website builder</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Edit the site OwBrand generated from your Brand Brain. Changes save as you go.
        </p>
      </div>
      {children}
    </div>
  );
}
