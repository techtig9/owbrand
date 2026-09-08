import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { isConfigured } from '@/lib/env';
import { AnalyticsDashboard } from '@/components/analytics/AnalyticsDashboard';
import { EmptyState } from '@/components/dashboard/shared';

export const dynamic = 'force-dynamic';

/**
 * Analytics.
 *
 * Replaces a two-line minified page whose four "metrics" were counts of
 * creative assets, queued posts, campaigns and open recommendations — none of
 * which measures performance. It also read the orphaned `scheduled_posts`
 * table and filtered brands by `user_id`, so a workspace member saw an empty
 * dashboard for their own team's brand.
 *
 * Brands come from `accessibleBrandIds`, and whether ingestion can run at all
 * is reported here rather than left for the user to infer from empty charts.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: { brand?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = supabaseAdmin();
  const accessible = await accessibleBrandIds(user.id, db);

  if (accessible.length === 0) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <Header />
        <EmptyState
          title="No brand yet"
          body="Analytics are measured per brand. Build a Brand Brain first."
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
  const brandId = requested && accessible.includes(requested) ? requested : accessible[0];

  const { data: brands } = await db
    .from('brands')
    .select('id, name')
    .in('id', accessible)
    .order('created_at', { ascending: false });

  // Two separate operator facts, and the failure modes are different: without
  // Meta credentials there is no data SOURCE; without CRON_SECRET nothing
  // TRIGGERS ingestion. Either way the charts would be empty for a reason the
  // user cannot see.
  const sourceConfigured = isConfigured.metaOAuth();
  const ingestionConfigured = isConfigured.publishingWorker();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Header>
        {(brands?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-2">
            {(brands ?? []).map((brand: { id: string; name: string }) => (
              <Link
                key={brand.id}
                href={`/dashboard/analytics?brand=${brand.id}`}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${
                  brand.id === brandId ? 'bg-ink text-canvas' : 'border border-line text-ink-soft'
                }`}
              >
                {brand.name}
              </Link>
            ))}
          </div>
        )}
      </Header>

      {(!sourceConfigured || !ingestionConfigured) && (
        <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Analytics collection is not running
          </p>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-ink-soft">
            {!sourceConfigured && (
              <li>
                No analytics source is configured — set{' '}
                <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">META_APP_ID</code>,{' '}
                <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">META_APP_SECRET</code> and{' '}
                <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">TOKEN_ENCRYPTION_KEY</code>.
              </li>
            )}
            {!ingestionConfigured && (
              <li>
                Nothing triggers ingestion — set{' '}
                <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">CRON_SECRET</code> and point a
                scheduler at{' '}
                <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">/api/cron/analytics</code>.
              </li>
            )}
          </ul>
        </div>
      )}

      <AnalyticsDashboard brandId={brandId} />
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="section-eyebrow">Insights</p>
        <h1 className="mt-3 font-display text-3xl font-bold">Analytics</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          What the platforms actually measured, and what OwBrand recommends because of it. Anything unmeasured is
          shown as such rather than as a zero.
        </p>
      </div>
      {children}
    </div>
  );
}
