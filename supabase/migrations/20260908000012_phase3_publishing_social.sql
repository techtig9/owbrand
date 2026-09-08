-- ============================================================================
-- Phase 3 — social publishing, scheduling and OAuth
-- ============================================================================
-- What this migration is for, in the order it matters:
--
--   1. OAuth state. Without a server-side, single-use state row the callback
--      cannot tell a legitimate redirect from a forged one, and an attacker
--      can attach their own social account to someone else's brand (a classic
--      OAuth CSRF / account-linking attack).
--
--   2. Encrypted credentials. `social_accounts.access_token` is a plaintext
--      `text not null` column. Long-lived Meta Page tokens must not sit there
--      readable by any service-role query, so this adds ciphertext columns and
--      makes the legacy plaintext column nullable so it can stop being written.
--
--   3. Job leases. `publishing_jobs` has status and attempts but no lease, so
--      two worker invocations overlapping — a slow run plus the next cron tick
--      — would both claim the same job and publish the same post twice. Social
--      publishing is not idempotent on the provider side: a duplicate post is
--      a visible, public mistake. The lease plus `claim_publishing_jobs()`
--      makes claiming atomic.
--
--   4. Account health, so an expired token surfaces as "reconnect" instead of
--      as a publish failure discovered when a scheduled post silently dies.
--
--   5. An attempt log, so "why did this fail" has an answer that survives the
--      next retry overwriting `error_message`.
--
-- Written to be re-runnable: every statement is guarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. OAuth state
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_states (
  -- The state value itself is the primary key: a hex nonce the callback must
  -- present. Storing it as the key makes single-use consumption a delete.
  state text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  provider text not null,
  -- Where to send the user afterwards. Validated against our own origin before
  -- being stored, so the callback never redirects off-site.
  return_to text,
  -- Scopes we asked for, so the callback can report what was actually granted.
  requested_scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  -- Short window. An OAuth round trip takes seconds; anything older is either
  -- abandoned or replayed.
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz
);

create index if not exists oauth_states_user_idx on public.oauth_states(user_id);
create index if not exists oauth_states_expiry_idx on public.oauth_states(expires_at);

comment on table public.oauth_states is
  'Single-use OAuth state nonces. A callback without a matching unconsumed, unexpired row is rejected.';

-- ---------------------------------------------------------------------------
-- 2. Encrypted credentials + account health on social_accounts
-- ---------------------------------------------------------------------------
alter table public.social_accounts
  add column if not exists access_token_ciphertext text,
  add column if not exists refresh_token_ciphertext text,
  -- Meta's model: a user token grants access to Pages, each with its own token.
  -- The Page/IG-business id is what publishing actually targets.
  add column if not exists external_page_id text,
  add column if not exists granted_scopes text[] not null default '{}',
  add column if not exists token_expires_at timestamptz,
  add column if not exists status text not null default 'active',
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- The legacy plaintext column must stop being required before any code path
-- can write a row without it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'social_accounts'
      and column_name = 'access_token' and is_nullable = 'NO'
  ) then
    alter table public.social_accounts alter column access_token drop not null;
  end if;
end $$;

comment on column public.social_accounts.access_token is
  'DEPRECATED and no longer written. Plaintext credentials moved to access_token_ciphertext (AES-256-GCM, see lib/crypto/secret-box.ts).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_accounts_status_check') then
    alter table public.social_accounts
      add constraint social_accounts_status_check
      check (status in ('active', 'expiring', 'needs_reconnect', 'revoked', 'error'));
  end if;
end $$;

create index if not exists social_accounts_status_idx on public.social_accounts(status);
create index if not exists social_accounts_brand_platform_idx on public.social_accounts(brand_id, platform);

-- ---------------------------------------------------------------------------
-- 3. Job leases on publishing_jobs
-- ---------------------------------------------------------------------------
alter table public.publishing_jobs
  add column if not exists brand_id uuid references public.brands(id) on delete cascade,
  add column if not exists social_account_id uuid references public.social_accounts(id) on delete set null,
  -- Lease: who holds this job and until when. A claim is only valid while
  -- `locked_until` is in the future, so a worker that dies mid-publish does
  -- not strand the job forever.
  add column if not exists locked_until timestamptz,
  add column if not exists locked_by text,
  add column if not exists max_attempts integer not null default 5,
  -- When the job becomes eligible again after a retryable failure.
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_response jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'publishing_jobs_status_check') then
    alter table public.publishing_jobs
      add constraint publishing_jobs_status_check
      check (status in ('queued', 'scheduled', 'claimed', 'publishing', 'published', 'failed', 'cancelled'));
  end if;
end $$;

-- The index the claim query actually uses.
create index if not exists publishing_jobs_claimable_idx
  on public.publishing_jobs(status, next_attempt_at, locked_until);

-- ---------------------------------------------------------------------------
-- 4. Attempt log
-- ---------------------------------------------------------------------------
create table if not exists public.publishing_attempts (
  id uuid primary key default gen_random_uuid(),
  publishing_job_id uuid not null references public.publishing_jobs(id) on delete cascade,
  social_post_id uuid references public.social_posts(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  attempt integer not null,
  outcome text not null,
  error_kind text,
  error_code text,
  error_message text,
  -- The provider's own response, minus anything credential-shaped. Kept
  -- because "the platform rejected this" is unanswerable without it.
  provider_response jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'publishing_attempts_outcome_check') then
    alter table public.publishing_attempts
      add constraint publishing_attempts_outcome_check
      check (outcome in ('published', 'retryable_failure', 'permanent_failure', 'needs_reconnect', 'skipped'));
  end if;
end $$;

create index if not exists publishing_attempts_job_idx on public.publishing_attempts(publishing_job_id, attempt);

-- ---------------------------------------------------------------------------
-- 5. social_posts: link back to the account used, and to the source asset
-- ---------------------------------------------------------------------------
alter table public.social_posts
  add column if not exists social_account_id uuid references public.social_accounts(id) on delete set null,
  add column if not exists content_asset_id uuid references public.content_assets(id) on delete set null,
  add column if not exists created_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_posts_status_check') then
    alter table public.social_posts
      add constraint social_posts_status_check
      check (status in ('draft', 'awaiting_approval', 'scheduled', 'queued', 'publishing', 'published', 'failed', 'cancelled'));
  end if;
end $$;

create index if not exists social_posts_scheduled_idx on public.social_posts(scheduled_for)
  where status in ('scheduled', 'queued');

-- ---------------------------------------------------------------------------
-- 6. Atomic job claim
-- ---------------------------------------------------------------------------
-- This is the whole reason the lease columns exist. `for update skip locked`
-- means two concurrent workers take disjoint sets of rows instead of both
-- reading the same "queued" job and publishing it twice.
--
-- SECURITY DEFINER because the worker runs with the service role and RLS on
-- publishing_jobs would otherwise apply; the function takes no caller-supplied
-- tenant filter, so it cannot be used to reach across tenants.
create or replace function public.claim_publishing_jobs(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 300
)
returns setof public.publishing_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_worker_id is null or length(p_worker_id) = 0 then
    raise exception 'a worker id is required';
  end if;

  -- Bound the batch: a runaway limit would let one invocation lease every job
  -- and then time out holding all of them.
  p_limit := least(greatest(coalesce(p_limit, 5), 1), 50);
  p_lease_seconds := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);

  return query
  with claimable as (
    select j.id
    from public.publishing_jobs j
    where j.status in ('queued', 'scheduled', 'claimed', 'publishing')
      -- Due now: either no schedule, or the scheduled time has passed.
      and (j.scheduled_for is null or j.scheduled_for <= now())
      -- Not backing off from a previous retryable failure.
      and (j.next_attempt_at is null or j.next_attempt_at <= now())
      -- Not currently leased by a live worker. An expired lease is reclaimable,
      -- which is what makes a crashed worker recoverable.
      and (j.locked_until is null or j.locked_until <= now())
      and j.attempts < j.max_attempts
    order by coalesce(j.scheduled_for, j.created_at)
    limit p_limit
    for update skip locked
  )
  update public.publishing_jobs j
     set status = 'claimed',
         locked_by = p_worker_id,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(j.started_at, now()),
         updated_at = now()
   where j.id in (select id from claimable)
  returning j.*;
end $$;

revoke all on function public.claim_publishing_jobs(text, integer, integer) from public, anon, authenticated;

comment on function public.claim_publishing_jobs(text, integer, integer) is
  'Atomically leases due publishing jobs to one worker. `for update skip locked` is what prevents two workers publishing the same post.';

-- ---------------------------------------------------------------------------
-- 7. Releasing a job after an attempt
-- ---------------------------------------------------------------------------
-- Kept in SQL so the state transition and the attempt log are written in one
-- transaction: a worker that crashed between "mark failed" and "log why" would
-- otherwise leave an unexplained failure.
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
  else
    -- Out of attempts, or a failure retrying cannot fix.
    v_next_status := 'failed';
  end if;

  update public.publishing_jobs
     set status = v_next_status,
         attempts = v_job.attempts,
         error_code = p_error_code,
         error_message = p_error_message,
         last_response = coalesce(p_provider_response, last_response),
         -- The lease is always released: holding it after an attempt would
         -- block the retry we just scheduled.
         locked_until = null,
         locked_by = null,
         next_attempt_at = case
           when v_next_status = 'queued'
             then now() + make_interval(secs => coalesce(p_retry_delay_seconds, 60))
           else null
         end,
         finished_at = case when v_next_status in ('published', 'failed') then now() else null end,
         updated_at = now()
   where id = p_job_id
  returning * into v_job;

  insert into public.publishing_attempts (
    publishing_job_id, social_post_id, brand_id, attempt, outcome,
    error_kind, error_code, error_message, provider_response, duration_ms
  ) values (
    p_job_id, v_job.social_post_id, v_job.brand_id, v_job.attempts, p_outcome,
    p_error_kind, p_error_code, p_error_message, p_provider_response, p_duration_ms
  );

  -- The user-visible post follows the job.
  update public.social_posts
     set status = case
           when p_outcome = 'published' then 'published'
           when v_next_status = 'failed' then 'failed'
           else 'queued'
         end,
         published_at = case when p_outcome = 'published' then now() else published_at end,
         external_post_id = coalesce(p_external_post_id, external_post_id),
         external_url = coalesce(p_external_url, external_url),
         last_error = case when p_outcome = 'published' then null else p_error_message end,
         updated_at = now()
   where id = v_job.social_post_id;

  return v_job;
end $$;

revoke all on function public.complete_publishing_job(uuid, text, text, text, text, text, text, jsonb, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.oauth_states enable row level security;
alter table public.publishing_attempts enable row level security;
alter table public.publishing_jobs enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_accounts enable row level security;

-- OAuth state belongs to the user who started the flow and to nobody else.
-- Note there is no policy for `anon`: the callback runs server-side with the
-- service role, so an unauthenticated request never needs to read these.
drop policy if exists "oauth states owner" on public.oauth_states;
create policy "oauth states owner" on public.oauth_states
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "social accounts owner" on public.social_accounts;
create policy "social accounts owner" on public.social_accounts
  for all to authenticated
  using (user_id = auth.uid() or (brand_id is not null and public.can_access_brand(brand_id)))
  with check (user_id = auth.uid());

drop policy if exists "social posts tenant" on public.social_posts;
create policy "social posts tenant" on public.social_posts
  for all to authenticated
  using (public.can_access_brand(brand_id))
  with check (public.can_access_brand(brand_id));

-- Jobs and attempts are readable through the brand, and writable only by the
-- worker (service role, which bypasses RLS). A tenant must be able to see why
-- their post failed; they must not be able to rewrite the job.
drop policy if exists "publishing jobs read" on public.publishing_jobs;
create policy "publishing jobs read" on public.publishing_jobs
  for select to authenticated
  using (
    brand_id is not null and public.can_access_brand(brand_id)
    or exists (
      select 1 from public.social_posts p
      where p.id = publishing_jobs.social_post_id
        and public.can_access_brand(p.brand_id)
    )
  );

drop policy if exists "publishing attempts read" on public.publishing_attempts;
create policy "publishing attempts read" on public.publishing_attempts
  for select to authenticated
  using (
    brand_id is not null and public.can_access_brand(brand_id)
    or exists (
      select 1 from public.social_posts p
      where p.id = publishing_attempts.social_post_id
        and public.can_access_brand(p.brand_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 9. Expired OAuth state cleanup
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_oauth_states()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.oauth_states
   where expires_at < now() - interval '1 hour'
      or consumed_at < now() - interval '1 hour';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.purge_expired_oauth_states() from public, anon, authenticated;
