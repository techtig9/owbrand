/**
 * Durable job persistence.
 *
 * Replaces two stubs that lied to their callers:
 *   - /api/jobs/create returned `{ id: crypto.randomUUID(), state: 'queued' }`
 *     and persisted nothing.
 *   - DatabasePublishingQueue.enqueue() returned a synthetic job id and
 *     persisted nothing, so /api/social/publish reported `{ queued: true }`
 *     for work that would never happen.
 *
 * Jobs now live in `generation_jobs`, keyed by (workspace_id, idempotency_key)
 * so a retried request returns the original job instead of creating a second
 * one. Execution is a Phase 2/3 concern; what Phase 1 guarantees is that a job
 * accepted by the API is actually recorded, survives a restart, and can be
 * queried back honestly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const JOB_TYPES = [
  'creative_generation',
  'video_generation',
  'campaign_generation',
  'analytics_sync',
  'social_publish',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  workspace_id: string;
  idempotency_key: string;
  type: JobType;
  state: JobState;
  progress: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface EnqueueResult {
  job: JobRecord;
  /** True when an existing job was returned rather than a new one created. */
  deduplicated: boolean;
}

type Db = SupabaseClient<any, any, any>;

/**
 * Persists a job, or returns the existing one for the same idempotency key.
 *
 * The uniqueness guarantee comes from the database
 * (`unique (workspace_id, idempotency_key)`), not from a read-then-write in
 * application code, so two concurrent requests cannot both create a job.
 */
export async function enqueueJob(
  input: {
    workspaceId: string;
    type: JobType;
    idempotencyKey: string;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
  },
  db: Db = supabaseAdmin()
): Promise<EnqueueResult> {
  const row = {
    workspace_id: input.workspaceId,
    idempotency_key: input.idempotencyKey,
    type: input.type,
    state: 'queued' as const,
    progress: 0,
    payload: input.payload ?? {},
    created_by: input.createdBy ?? null,
  };

  const { data, error } = await db.from('generation_jobs').insert(row).select('*').single();

  if (!error && data) {
    return { job: data as JobRecord, deduplicated: false };
  }

  // 23505 = unique_violation: this key has already been accepted. Return the
  // original job so a client retry is a no-op rather than a duplicate.
  if (error && (error as { code?: string }).code === '23505') {
    const existing = await findJobByIdempotencyKey(input.workspaceId, input.idempotencyKey, db);
    if (existing) {
      logger.info('jobs:deduplicated', {
        workspaceId: input.workspaceId,
        jobId: existing.id,
        type: input.type,
      });
      return { job: existing, deduplicated: true };
    }
  }

  throw error ?? new Error('Could not persist job.');
}

export async function findJobByIdempotencyKey(
  workspaceId: string,
  idempotencyKey: string,
  db: Db = supabaseAdmin()
): Promise<JobRecord | null> {
  const { data } = await db
    .from('generation_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  return (data as JobRecord | null) ?? null;
}

/** Fetches a job, scoped to a workspace so an id alone is not enough to read it. */
export async function getJob(
  workspaceId: string,
  jobId: string,
  db: Db = supabaseAdmin()
): Promise<JobRecord | null> {
  const { data } = await db
    .from('generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return (data as JobRecord | null) ?? null;
}

/** Records a state transition. Used by workers in later phases. */
export async function updateJobState(
  jobId: string,
  patch: {
    state?: JobState;
    progress?: number;
    result?: Record<string, unknown> | null;
    error?: string | null;
  },
  db: Db = supabaseAdmin()
): Promise<void> {
  const update: Record<string, unknown> = { ...patch };

  if (patch.state === 'running') update.started_at = new Date().toISOString();
  if (patch.state === 'completed' || patch.state === 'failed' || patch.state === 'cancelled') {
    update.completed_at = new Date().toISOString();
  }

  const { error } = await db.from('generation_jobs').update(update).eq('id', jobId);
  if (error) {
    logger.error('jobs:state_update_failed', error, { jobId });
    throw error;
  }
}

/** The workspace a user owns, used to scope jobs when the client did not name one. */
export async function primaryWorkspaceId(userId: string, db: Db = supabaseAdmin()): Promise<string | null> {
  const { data } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
