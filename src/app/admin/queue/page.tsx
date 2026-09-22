import { supabaseAdmin } from '@/lib/supabase/admin';
import { QueueTable } from '@/components/admin/QueueTable';

export const dynamic = 'force-dynamic';

/**
 * The dead-letter queue.
 *
 * Shows jobs that exhausted their retries against a platform that was failing
 * — the set worth replaying once it recovers. Permanently failed jobs are
 * listed separately and without a requeue action, because retrying them
 * produces the identical error and a bulk replay that included them would
 * republish content that was correctly abandoned.
 */
export default async function AdminQueuePage() {
  const db = supabaseAdmin();

  const [dead, permanent] = await Promise.all([
    db
      .from('publishing_jobs')
      .select(
        'id, brand_id, platform, attempts, max_attempts, requeue_count, dead_lettered_at, dead_letter_reason'
      )
      .eq('status', 'dead_letter')
      .order('dead_lettered_at', { ascending: false })
      .limit(100),
    db
      .from('publishing_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed'),
  ]);

  const jobs = dead.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Publishing queue</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Jobs that ran out of attempts while the platform was failing. These are the ones worth
          replaying — {permanent.count ?? 0} other job{permanent.count === 1 ? '' : 's'} failed for
          reasons a retry cannot fix and are not listed.
        </p>
      </div>

      <QueueTable jobs={jobs} />
    </div>
  );
}
