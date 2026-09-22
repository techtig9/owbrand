import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { buildMonth, cadence, daysInMonth, type CalendarPost } from '@/lib/calendar/month';
import { Button, EmptyState } from '@/components/ui';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { CadencePanel } from '@/components/calendar/CadencePanel';

export const dynamic = 'force-dynamic';

/**
 * The content calendar.
 *
 * Deliberately a view, not a second source of truth: it reads the same
 * `social_posts` the scheduler and the publishing worker use. A calendar with
 * its own table is a calendar that drifts from what actually publishes, and
 * the drift is only noticed when a post does not go out.
 *
 * What it adds over the scheduler's list is cadence — the gaps and the
 * clustering — which is a shape, and so needs a grid to be visible at all.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string; brand?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = supabaseAdmin();
  const accessible = await accessibleBrandIds(user.id, db);

  if (accessible.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-5 w-5" />}
        title="No brand yet"
        body="The calendar shows posts scheduled against a brand. Build a Brand Brain first."
        action={
          <Link href="/dashboard/ai-generator">
            <Button>Build my brand</Button>
          </Link>
        }
      />
    );
  }

  const now = new Date();
  /*
   * Parsed defensively. A hand-edited `?month=13` must not produce a grid for
   * a month that does not exist — `new Date(2026, 12, 1)` silently rolls into
   * January 2027, and the page would then disagree with its own heading.
   */
  const year = clamp(Number(searchParams.year), 2000, 2100, now.getUTCFullYear());
  const month = clamp(Number(searchParams.month), 1, 12, now.getUTCMonth() + 1);

  const brandFilter = searchParams.brand && accessible.includes(searchParams.brand)
    ? [searchParams.brand]
    : accessible;

  /*
   * One query spanning the visible grid plus the cadence horizon, rather than
   * one per day. The range is padded by a week on each side because the grid
   * shows leading and trailing days from the neighbouring months, and a post
   * on one of those cells would otherwise be invisible in the only view built
   * to show it.
   */
  const from = new Date(Date.UTC(year, month - 1, 1));
  from.setUTCDate(from.getUTCDate() - 7);
  const to = new Date(Date.UTC(year, month - 1, daysInMonth(year, month)));
  to.setUTCDate(to.getUTCDate() + 21);

  const { data } = await db
    .from('social_posts')
    .select('id, brand_id, platform, status, caption, scheduled_for, published_at')
    .in('brand_id', brandFilter)
    .or(
      `and(scheduled_for.gte.${from.toISOString()},scheduled_for.lte.${to.toISOString()}),` +
        `and(published_at.gte.${from.toISOString()},published_at.lte.${to.toISOString()})`
    )
    .limit(1000);

  const posts = (data ?? []) as CalendarPost[];
  const grid = buildMonth(year, month, posts, now);
  const insight = cadence(posts, now);

  const { data: brands } = await db.from('brands').select('id, name').in('id', accessible);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-eyebrow">Calendar</p>
          <h1 className="mt-3 font-display text-3xl font-bold">{grid.label}</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Everything scheduled and published, by day. The same queue the scheduler shows.
          </p>
        </div>
        <Link href="/dashboard/scheduler" className="btn-ghost shrink-0">
          Queue view
        </Link>
      </div>

      <CadencePanel insight={insight} />

      <MonthGrid
        grid={grid}
        brands={brands ?? []}
        activeBrand={searchParams.brand && accessible.includes(searchParams.brand) ? searchParams.brand : null}
      />
    </div>
  );
}

/** Falls back rather than throwing: a bad URL should show this month, not a 500. */
function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
