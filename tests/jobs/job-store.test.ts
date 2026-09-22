import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Durable job persistence.
 *
 * /api/jobs/create previously returned `{ id: crypto.randomUUID(), state:
 * 'queued' }` and wrote nothing, so a client was told work had been accepted
 * that did not exist. These tests assert the two properties that fix requires:
 * the job is actually stored, and the same idempotency key never produces two.
 */

interface JobRow {
  id: string;
  workspace_id: string;
  idempotency_key: string;
  type: string;
  state: string;
  progress: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

let jobs: JobRow[];
let workspaces: Array<{ id: string; owner_id: string; created_at: string }>;
let nextId: number;

function makeFakeDb() {
  return {
    from(table: string) {
      let filtered: any[] =
        table === 'generation_jobs' ? [...jobs] : table === 'workspaces' ? [...workspaces] : [];
      let pendingInsert: Partial<JobRow> | null = null;
      let pendingUpdate: Partial<JobRow> | null = null;
      let mode: 'select' | 'insert' | 'update' = 'select';

      const builder: Record<string, any> = {
        insert(values: Partial<JobRow>) {
          mode = 'insert';
          pendingInsert = values;
          return builder;
        },
        update(values: Partial<JobRow>) {
          mode = 'update';
          pendingUpdate = values;
          return builder;
        },
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filtered = filtered.filter((r) => r[column] === value);
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          filtered = filtered.slice(0, n);
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        },
        single() {
          if (mode === 'insert' && pendingInsert) {
            // Enforce the real unique (workspace_id, idempotency_key).
            const clash = jobs.find(
              (j) =>
                j.workspace_id === pendingInsert!.workspace_id &&
                j.idempotency_key === pendingInsert!.idempotency_key
            );
            if (clash) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
            }
            const row: JobRow = {
              id: `job-${nextId++}`,
              workspace_id: pendingInsert.workspace_id!,
              idempotency_key: pendingInsert.idempotency_key!,
              type: pendingInsert.type!,
              state: pendingInsert.state ?? 'queued',
              progress: pendingInsert.progress ?? 0,
              payload: pendingInsert.payload ?? {},
              result: null,
              error: null,
              created_by: pendingInsert.created_by ?? null,
              created_at: new Date().toISOString(),
              started_at: null,
              completed_at: null,
            };
            jobs.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        },
        then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
          if (mode === 'update' && pendingUpdate) {
            for (const row of filtered) Object.assign(row, pendingUpdate);
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve({ data: filtered, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => makeFakeDb() }));

const { enqueueJob, getJob, findJobByIdempotencyKey, updateJobState, primaryWorkspaceId } = await import(
  '@/lib/jobs/job-store'
);

const WS = 'aaaa0000-0000-0000-0000-00000000ffff';
const OTHER_WS = 'bbbb0000-0000-0000-0000-00000000ffff';
const USER = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jobs = [];
  nextId = 1;
  workspaces = [{ id: WS, owner_id: USER, created_at: '2026-01-01T00:00:00Z' }];
});

describe('enqueueJob', () => {
  it('actually persists the job', async () => {
    const { job, deduplicated } = await enqueueJob({
      workspaceId: WS,
      type: 'creative_generation',
      idempotencyKey: 'key-persist',
      createdBy: USER,
    });

    expect(deduplicated).toBe(false);
    expect(job.state).toBe('queued');
    // The whole point: it is in the store, not just in the response.
    expect(jobs).toHaveLength(1);
    expect(await findJobByIdempotencyKey(WS, 'key-persist')).toMatchObject({ id: job.id });
  });

  it('returns the existing job for a repeated idempotency key', async () => {
    const first = await enqueueJob({
      workspaceId: WS,
      type: 'social_publish',
      idempotencyKey: 'key-dedupe',
    });

    const second = await enqueueJob({
      workspaceId: WS,
      type: 'social_publish',
      idempotencyKey: 'key-dedupe',
    });

    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(jobs).toHaveLength(1);
  });

  it('scopes the idempotency key per workspace', async () => {
    await enqueueJob({ workspaceId: WS, type: 'analytics_sync', idempotencyKey: 'shared-key' });
    const other = await enqueueJob({
      workspaceId: OTHER_WS,
      type: 'analytics_sync',
      idempotencyKey: 'shared-key',
    });

    expect(other.deduplicated).toBe(false);
    expect(jobs).toHaveLength(2);
  });

  it('stores the payload', async () => {
    const { job } = await enqueueJob({
      workspaceId: WS,
      type: 'video_generation',
      idempotencyKey: 'key-payload',
      payload: { durationSeconds: 15, aspectRatio: '9:16' },
    });
    expect(job.payload).toMatchObject({ durationSeconds: 15, aspectRatio: '9:16' });
  });
});

describe('getJob', () => {
  it('returns a job within the caller’s workspace', async () => {
    const { job } = await enqueueJob({ workspaceId: WS, type: 'creative_generation', idempotencyKey: 'k1' });
    await expect(getJob(WS, job.id)).resolves.toMatchObject({ id: job.id });
  });

  it('REFUSES a job id from another workspace', async () => {
    const { job } = await enqueueJob({ workspaceId: WS, type: 'creative_generation', idempotencyKey: 'k2' });
    // Knowing the id must not be enough — this is the tenant boundary.
    await expect(getJob(OTHER_WS, job.id)).resolves.toBeNull();
  });
});

describe('updateJobState', () => {
  it('stamps started_at when moving to running', async () => {
    const { job } = await enqueueJob({ workspaceId: WS, type: 'creative_generation', idempotencyKey: 'k3' });
    await updateJobState(job.id, { state: 'running', progress: 25 });

    const stored = jobs.find((j) => j.id === job.id)!;
    expect(stored.state).toBe('running');
    expect(stored.progress).toBe(25);
    expect(stored.started_at).toBeTruthy();
    expect(stored.completed_at).toBeNull();
  });

  it('stamps completed_at on a terminal state', async () => {
    const { job } = await enqueueJob({ workspaceId: WS, type: 'creative_generation', idempotencyKey: 'k4' });
    await updateJobState(job.id, { state: 'completed', progress: 100, result: { ok: true } });

    const stored = jobs.find((j) => j.id === job.id)!;
    expect(stored.state).toBe('completed');
    expect(stored.completed_at).toBeTruthy();
    expect(stored.result).toMatchObject({ ok: true });
  });

  it('records a failure reason', async () => {
    const { job } = await enqueueJob({ workspaceId: WS, type: 'creative_generation', idempotencyKey: 'k5' });
    await updateJobState(job.id, { state: 'failed', error: 'provider timed out' });

    const stored = jobs.find((j) => j.id === job.id)!;
    expect(stored.state).toBe('failed');
    expect(stored.error).toBe('provider timed out');
    expect(stored.completed_at).toBeTruthy();
  });
});

describe('primaryWorkspaceId', () => {
  it('returns the workspace the user owns', async () => {
    await expect(primaryWorkspaceId(USER)).resolves.toBe(WS);
  });

  it('returns null when the user owns none', async () => {
    await expect(primaryWorkspaceId('99999999-9999-9999-9999-999999999999')).resolves.toBeNull();
  });
});
