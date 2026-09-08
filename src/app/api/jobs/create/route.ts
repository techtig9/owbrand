import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertWorkspaceAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { enqueueJob, getJob, primaryWorkspaceId, JOB_TYPES } from '@/lib/jobs/job-store';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * SECURITY + CORRECTNESS FIX (Phase 1)
 *
 * Before: no authentication at all, accepted an arbitrary client-supplied
 * workspaceId, and persisted nothing — it returned a random UUID and
 * `state: 'queued'` for a job that did not exist.
 *
 * Now: authenticated, the workspace is authorized against the caller's
 * membership, and the job is written to `generation_jobs` under a unique
 * (workspace_id, idempotency_key) so retries are idempotent.
 */

const CreateJob = z.object({
  type: z.enum(JOB_TYPES),
  workspaceId: uuidSchema.optional(),
  idempotencyKey: z.string().min(8).max(200),
  payload: z.record(z.unknown()).optional(),
});

export const POST = routeHandler('/api/jobs/create', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, CreateJob);
  const db = supabaseAdmin();

  // Never trust a client-supplied workspaceId: either authorize the one they
  // named, or fall back to the workspace they own.
  let workspaceId = body.workspaceId ?? null;
  if (workspaceId) {
    await assertWorkspaceAccess(user.id, workspaceId, db);
  } else {
    workspaceId = await primaryWorkspaceId(user.id, db);
    if (!workspaceId) throw ApiError.notFound('No workspace available for this account.');
  }

  const { job, deduplicated } = await enqueueJob(
    {
      workspaceId,
      type: body.type,
      idempotencyKey: body.idempotencyKey,
      payload: body.payload ?? {},
      createdBy: user.id,
    },
    db
  );

  return NextResponse.json(
    {
      accepted: true,
      deduplicated,
      job: {
        id: job.id,
        type: job.type,
        state: job.state,
        progress: job.progress,
        workspaceId: job.workspace_id,
        createdAt: job.created_at,
      },
    },
    { status: deduplicated ? 200 : 202 }
  );
});

const StatusQuery = z.object({
  jobId: uuidSchema,
  workspaceId: uuidSchema.optional(),
});

/** Job status. Scoped to a workspace the caller belongs to. */
export const GET = routeHandler('/api/jobs/create', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { jobId, workspaceId: requested } = parseSearchParams(request, StatusQuery);
  const db = supabaseAdmin();

  let workspaceId = requested ?? null;
  if (workspaceId) {
    await assertWorkspaceAccess(user.id, workspaceId, db);
  } else {
    workspaceId = await primaryWorkspaceId(user.id, db);
    if (!workspaceId) throw ApiError.notFound('Job not found.');
  }

  const job = await getJob(workspaceId, jobId, db);
  if (!job) throw ApiError.notFound('Job not found.');

  return NextResponse.json({
    job: {
      id: job.id,
      type: job.type,
      state: job.state,
      progress: job.progress,
      error: job.error,
      result: job.result,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    },
  });
});
