import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireAdminUser } from '@/lib/auth/guards';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * The dead-letter queue, for operators.
 *
 * A dead-letter state that nothing can see is a renamed failure. This is the
 * other half of migration 20260922000017: the list of jobs that ran out of
 * attempts against a platform that was failing, and the one action worth
 * taking on them.
 *
 * Permanently failed jobs are NOT listed. They need no decision — retrying a
 * post whose platform account was revoked produces the identical error — and
 * mixing them in is how a bulk requeue republishes content that was correctly
 * abandoned.
 */

const RequeueBody = z.object({
  jobId: uuidSchema,
});

export const GET = routeHandler('/api/admin/queue', async (request: Request) => {
  await requireAdminUser();

  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 50), 200);
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('publishing_jobs')
    .select(
      'id, brand_id, platform, attempts, max_attempts, requeue_count, dead_lettered_at, dead_letter_reason, error_code, social_post_id'
    )
    .eq('status', 'dead_letter')
    .order('dead_lettered_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  /*
   * Counted separately rather than derived from the page above, which would
   * report "50" forever once the list is longer than a page and quietly
   * understate an incident.
   */
  const { count } = await db
    .from('publishing_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'dead_letter');

  return NextResponse.json({ jobs: data ?? [], total: count ?? 0 });
});

export const POST = routeHandler('/api/admin/queue', async (request: Request) => {
  const admin = await requireAdminUser();
  const { jobId } = await parseJsonBody(request, RequeueBody);

  const db = supabaseAdmin();
  const { data, error } = await db.rpc('requeue_dead_letter_job', { p_job_id: jobId });

  if (error) throw error;

  const result = (Array.isArray(data) ? data[0] : data) as
    | { requeued: boolean; detail: string | null }
    | undefined;

  if (!result?.requeued) {
    // The function re-checks the status under a row lock, so this is also what
    // a lost race looks like — two admins clicking requeue on the same job.
    throw ApiError.conflict(result?.detail ?? 'That job could not be requeued.');
  }

  await db.from('audit_logs').insert({
    actor_id: admin.id,
    actor_type: 'admin',
    action: 'queue.requeued',
    entity_type: 'publishing_job',
    entity_id: jobId,
  });

  logger.info('admin:queue_requeued', { jobId });

  return NextResponse.json({ requeued: true });
});
