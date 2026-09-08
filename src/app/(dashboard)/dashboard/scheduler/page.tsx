import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { isConfigured } from '@/lib/env';
import { PublishQueue } from '@/components/social/PublishQueue';
import { EmptyState } from '@/components/dashboard/shared';

export const dynamic = 'force-dynamic';

/**
 * The scheduler.
 *
 * Reads the queue the worker actually publishes from. The version this
 * replaces queried `scheduled_posts` scoped to `user_id` — a table with no
 * worker behind it, and a scope that hid a workspace's shared calendar from
 * everyone but its creator.
 */
export default async function SchedulerPage({ searchParams }: { searchParams: { brand?: string } }) {
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
          body="Posts are scheduled against a brand. Build a Brand Brain first."
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

  // Whether anything drains the queue is an operator fact the user should not
  // have to infer from posts silently never going out.
  const workerConfigured = isConfigured.publishingWorker();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Header />

      {!workerConfigured && (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Publishing is paused</p>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            The publishing worker is not configured on this server, so scheduling is disabled and nothing queued
            would be sent. An operator needs to set{' '}
            <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">CRON_SECRET</code> and point a
            scheduler at <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">/api/cron/publish</code>.
          </p>
        </div>
      )}

      <PublishQueue brandId={brandId} />
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="section-eyebrow">Scheduler</p>
        <h1 className="mt-3 font-display text-3xl font-bold">Publishing queue</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Everything queued, published, or failed — with what the platform actually said.
        </p>
      </div>
      <Link href="/dashboard/connections" className="btn-ghost shrink-0">
        Connected accounts
      </Link>
    </div>
  );
}
