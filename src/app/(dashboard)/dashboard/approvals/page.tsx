import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { ApprovalInbox } from '@/components/approvals/ApprovalInbox';
import { EmptyState } from '@/components/dashboard/shared';

export const dynamic = 'force-dynamic';

/**
 * The Approvals screen.
 *
 * The factuality guard writes findings to `content_factuality`; before this
 * page existed they were recorded and never seen, which meant the guard could
 * block publication with no way for anyone to clear it. This is the other half
 * of that control.
 *
 * As on the Website screen, the brand comes from the caller's accessible set —
 * a brandId in the query string can never widen it.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: { brand?: string } }) {
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
          body="Approvals apply to content generated for a brand. Build a Brand Brain first."
          action={
            <Link href="/dashboard/ai-generator" className="btn-primary">
              Build my brand
            </Link>
          }
        />
      </div>
    );
  }

  const requested = searchParams.brand;
  const brandId = requested && accessible.includes(requested) ? requested : undefined;

  const { data: brands } = await db
    .from('brands')
    .select('id, name')
    .in('id', accessible)
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Header>
        {(brands?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/approvals"
              className={`rounded-full px-4 py-2 text-xs font-semibold ${
                brandId ? 'border border-line text-content-secondary' : 'bg-ink text-canvas'
              }`}
            >
              All brands
            </Link>
            {(brands ?? []).map((brand: { id: string; name: string }) => (
              <Link
                key={brand.id}
                href={`/dashboard/approvals?brand=${brand.id}`}
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

      <ApprovalInbox brandId={brandId} />
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="section-eyebrow">Approvals</p>
        <h1 className="mt-3 font-display text-3xl font-bold">Review queue</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Generated copy that tripped a factuality check waits here. Blocking findings must be reviewed before the
          content can be published.
        </p>
      </div>
      {children}
    </div>
  );
}
