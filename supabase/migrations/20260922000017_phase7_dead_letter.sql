-- ============================================================================
-- Phase 7: a dead-letter state for the publishing queue.
--
-- Idempotent. No data is destroyed; one check constraint is widened and
-- existing rows are reclassified only where the evidence is unambiguous.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Why this is not just 'failed'
-- ----------------------------------------------------------------------------
-- `complete_publishing_job` wrote 'failed' for two conditions that need
-- completely different responses from an operator:
--
--   1. A PERMANENT failure — the post was deleted, the platform is unknown,
--      the account was revoked. Retrying produces the identical error. There is
--      nothing to do and the job is correctly closed.
--   2. EXHAUSTED RETRIES — the platform was returning 500s, or timing out, and
--      the attempt ceiling was reached. The job is not broken; the world was.
--      Once the platform recovers, the job would succeed on a retry.
--
-- Collapsing them meant the queue could not answer the only question worth
-- asking after an incident: which jobs did we give up on that would work now?
-- Rerunning everything in 'failed' would republish posts that legitimately
-- cannot be published, and rerunning none of them loses real customer content.
--
-- Separating the states makes the answer a `where` clause.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'publishing_jobs_status_check') then
    alter table public.publishing_jobs drop constraint publishing_jobs_status_check;
  end if;

  alter table public.publishing_jobs
    add constraint publishing_jobs_status_check
    check (status in (
      'queued', 'scheduled', 'claimed', 'publishing',
      'published', 'failed', 'dead_letter', 'cancelled'
    ));
end;
$$;

alter table public.publishing_jobs
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists dead_letter_reason text,
  -- Counts how many times an operator has requeued this job. Without it, a job
  -- that is requeued repeatedly looks identical to one that failed once, and
  -- the loop is invisible.
  add column if not exists requeue_count integer not null default 0;

comment on column public.publishing_jobs.dead_letter_reason is
  'Why the job stopped. Set only for status = dead_letter; permanent failures '
  'use status = failed and error_code.';

-- Partial: dead-lettered jobs are rare, and an operator queries for exactly
-- this set. A full index would be mostly empty pages.
create index if not exists publishing_jobs_dead_letter_idx
  on public.publishing_jobs(dead_lettered_at desc)
  where status = 'dead_letter';

-- ----------------------------------------------------------------------------
-- Reclassify existing rows, but only where the evidence is unambiguous
-- ----------------------------------------------------------------------------
-- A job already at its attempt ceiling with no permanent error code recorded
-- exhausted its retries. Rows with an error code are left alone: guessing at
-- their cause and moving them would make a requeue sweep republish content
-- that was correctly abandoned.
update public.publishing_jobs
   set status = 'dead_letter',
       dead_lettered_at = coalesce(finished_at, updated_at, now()),
       dead_letter_reason = 'attempt ceiling reached (reclassified by migration)'
 where status = 'failed'
   and attempts >= max_attempts
   and error_code is null;

-- ----------------------------------------------------------------------------
-- The completion function learns the difference
-- ----------------------------------------------------------------------------
create or replace function public.complete_publishing_job(
  p_job_id uuid,
  p_outcome text,
  p_external_post_id text default null,
  p_external_url text default null,
  p_error_kind text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_provider_response jsonb default null,
  p_duration_ms integer default null,
  p_retry_delay_seconds integer default null
)
returns public.publishing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.publishing_jobs;
  v_next_status text;
  v_dead_reason text;
begin
  select * into v_job from public.publishing_jobs where id = p_job_id for update;
  if not found then
    raise exception 'publishing job % not found', p_job_id;
  end if;

  if p_outcome not in ('published', 'retryable_failure', 'permanent_failure', 'needs_reconnect', 'skipped') then
    raise exception 'unknown outcome %', p_outcome;
  end if;

  -- Attempts are counted here, not by the caller, so a worker that retries
  -- without going through this function cannot escape the ceiling.
  v_job.attempts := v_job.attempts + 1;

  if p_outcome = 'published' then
    v_next_status := 'published';
  elsif p_outcome = 'retryable_failure' and v_job.attempts < v_job.max_attempts then
    v_next_status := 'queued';
  elsif p_outcome = 'retryable_failure' then
    -- The retryable case that ran out of attempts: the world was broken, not
    -- the job. This is the set worth replaying after an incident.
    v_next_status := 'dead_letter';
    v_dead_reason := format('attempt ceiling reached (%s/%s): %s',
                            v_job.attempts, v_job.max_attempts,
                            coalesce(p_error_code, 'unknown'));
  else
    -- permanent_failure, needs_reconnect, skipped — retrying is pointless.
    v_next_status := 'failed';
  end if;

  update public.publishing_jobs
     set status = v_next_status,
         attempts = v_job.attempts,
         error_code = p_error_code,
         error_message = p_error_message,
         last_response = coalesce(p_provider_response, last_response),
         locked_until = null,
         locked_by = null,
         next_attempt_at = case
           when v_next_status = 'queued'
             then now() + make_interval(secs => coalesce(p_retry_delay_seconds, 60))
           else null
         end,
         dead_lettered_at = case when v_next_status = 'dead_letter' then now() else dead_lettered_at end,
         dead_letter_reason = case when v_next_status = 'dead_letter' then v_dead_reason else dead_letter_reason end,
         finished_at = case
           when v_next_status in ('published', 'failed', 'dead_letter') then now()
           else null
         end,
         updated_at = now()
   where id = p_job_id
  returning * into v_job;

  insert into public.publishing_attempts (
    publishing_job_id, social_post_id, brand_id, attempt, outcome,
    error_kind, error_code, error_message, provider_response, duration_ms
  )
  values (
    v_job.id, v_job.social_post_id, v_job.brand_id, v_job.attempts, p_outcome,
    p_error_kind, p_error_code, p_error_message, p_provider_response, p_duration_ms
  );

  -- The user-visible post follows the job. A dead-lettered job reads as
  -- 'failed' to the customer, because "we gave up after five tries" and "this
  -- cannot be published" are the same thing from their side — the distinction
  -- is operational, and dressing it up as a third state in the UI would be
  -- exposing our queue's internals as if they were the customer's problem.
  update public.social_posts
     set status = case
           when v_next_status = 'published' then 'published'
           when v_next_status = 'queued' then 'queued'
           when v_next_status in ('failed', 'dead_letter') then 'failed'
           else status
         end,
         external_post_id = coalesce(p_external_post_id, external_post_id),
         external_url = coalesce(p_external_url, external_url),
         published_at = case when v_next_status = 'published' then now() else published_at end,
         updated_at = now()
   where id = v_job.social_post_id;

  return v_job;
end;
$$;

-- ----------------------------------------------------------------------------
-- Requeueing
-- ----------------------------------------------------------------------------
-- Deliberately narrow: it moves ONLY dead-lettered jobs, and only back to
-- 'queued'. A general "set this job to any status" primitive would let an
-- operator mark a job published without publishing it, and the first time
-- someone does that to clear a dashboard, the post is silently lost.
--
-- Attempts are reset so the job gets a fresh budget — requeueing a job that
-- is already at its ceiling would otherwise dead-letter it again on the first
-- failure, which looks exactly like the requeue not working.
create or replace function public.requeue_dead_letter_job(p_job_id uuid)
returns table (requeued boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.publishing_jobs;
begin
  select * into v_job from public.publishing_jobs where id = p_job_id for update;

  if not found then
    return query select false, 'no such job'::text;
    return;
  end if;

  if v_job.status <> 'dead_letter' then
    -- Re-checked under the row lock, so two concurrent requeues cannot both
    -- succeed and produce two publishes of the same post.
    return query select false, format('job is %s, not dead_letter', v_job.status)::text;
    return;
  end if;

  update public.publishing_jobs
     set status = 'queued',
         attempts = 0,
         requeue_count = requeue_count + 1,
         next_attempt_at = now(),
         dead_lettered_at = null,
         -- Kept: it is the record of why this needed a requeue at all.
         error_code = null,
         error_message = null,
         finished_at = null,
         locked_until = null,
         locked_by = null,
         updated_at = now()
   where id = p_job_id;

  update public.social_posts
     set status = 'queued', updated_at = now()
   where id = v_job.social_post_id;

  return query select true, null::text;
end;
$$;

-- Service role only, like every other queue primitive. A tenant-callable
-- requeue is an unbounded publish trigger.
revoke all on function public.requeue_dead_letter_job(uuid) from public, anon, authenticated;
