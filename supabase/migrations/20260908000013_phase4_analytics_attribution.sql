-- ============================================================================
-- Phase 4 — analytics ingestion, attribution and recommendations
-- ============================================================================
-- The analytics tables from the original phase-7 migration already exist and
-- already have the right unique constraints. What was missing is everything
-- that would put data in them or make sense of it:
--
--   1. Ingestion state. Without a per-account cursor, every run either
--      re-fetches the full history (burning Meta's rate limit, which is
--      measured in calls per hour) or silently skips days after a failure. The
--      cursor is what makes ingestion incremental AND recoverable.
--
--   2. Post-level metrics. `analytics_daily` is an account-per-day rollup, so
--      "which post underperformed" — the question the whole AI Marketing
--      Manager is built to answer — is unanswerable from it.
--
--   3. Recommendation evidence. `ai_recommendations` has title, text and
--      priority but no confidence and no source metrics. The master command
--      requires both: a recommendation the user cannot audit is indistinguishable
--      from a fabricated one.
--
--   4. RLS on all of it. These tables carry a tenant's commercial performance.
--
-- Re-runnable: every statement is guarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ingestion cursors
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_ingestion_state (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  social_account_id uuid references public.social_accounts(id) on delete cascade,
  platform text not null,
  -- The last metric_date successfully written. Ingestion resumes from the day
  -- after this, so a failed run costs a retry rather than a gap.
  last_ingested_date date,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  consecutive_failures integer not null default 0,
  -- Set when a platform tells us to stop asking for a while.
  backoff_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, platform, social_account_id)
);

create index if not exists analytics_ingestion_due_idx
  on public.analytics_ingestion_state(backoff_until, last_run_at);

comment on table public.analytics_ingestion_state is
  'Per-account ingestion cursor. last_ingested_date is what makes analytics ingestion incremental and gap-free across failures.';

-- ---------------------------------------------------------------------------
-- 2. Post-level metrics
-- ---------------------------------------------------------------------------
-- Snapshotted rather than overwritten: engagement on a post keeps accruing for
-- days, so "impressions on 2026-09-08 as measured on 2026-09-10" is a
-- different and useful fact from the final total. The unique key includes the
-- snapshot date so a re-run of the same day is an upsert, not a duplicate.
create table if not exists public.post_metrics (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  social_post_id uuid references public.social_posts(id) on delete cascade,
  platform text not null,
  -- The platform's own post id, so metrics survive a social_posts deletion and
  -- can be matched for posts published outside OwBrand.
  external_post_id text not null,
  snapshot_date date not null,
  published_at timestamptz,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  engagements bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  clicks bigint not null default 0,
  video_views bigint not null default 0,
  -- Everything the platform returned, so a metric we do not model yet is not
  -- lost and does not need a re-fetch later.
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, platform, external_post_id, snapshot_date)
);

create index if not exists post_metrics_brand_date_idx
  on public.post_metrics(brand_id, snapshot_date desc);
create index if not exists post_metrics_post_idx
  on public.post_metrics(social_post_id, snapshot_date desc);

-- ---------------------------------------------------------------------------
-- 3. Recommendations: confidence and evidence
-- ---------------------------------------------------------------------------
alter table public.ai_recommendations
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  -- 0..1. Derived from sample size and window coverage, never asserted.
  add column if not exists confidence numeric(4,3),
  -- The metrics this recommendation was computed from, so the user can audit
  -- it. A recommendation with no evidence must not be shown as a finding.
  add column if not exists evidence jsonb not null default '{}'::jsonb,
  add column if not exists signal text,
  add column if not exists window_days integer,
  -- Rows the signal was computed over. A recommendation from 3 posts is not
  -- the same claim as one from 300.
  add column if not exists sample_size integer,
  add column if not exists generated_by text,
  add column if not exists model text,
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid references public.users(id) on delete set null,
  add column if not exists applied_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_recommendations_confidence_range') then
    alter table public.ai_recommendations
      add constraint ai_recommendations_confidence_range
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ai_recommendations_status_check') then
    alter table public.ai_recommendations
      add constraint ai_recommendations_status_check
      check (status in ('open', 'applied', 'dismissed', 'expired'));
  end if;
end $$;

-- One live recommendation per signal per brand: regenerating must refresh the
-- existing row rather than stacking duplicates every time the cron runs.
create unique index if not exists ai_recommendations_open_signal_idx
  on public.ai_recommendations(brand_id, signal)
  where status = 'open' and signal is not null;

create index if not exists ai_recommendations_brand_status_idx
  on public.ai_recommendations(brand_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Attribution: the model is a property of the read, not the row
-- ---------------------------------------------------------------------------
alter table public.attribution_touchpoints
  add column if not exists content_asset_id uuid references public.content_assets(id) on delete set null,
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null,
  -- Groups touchpoints belonging to one customer journey. Without it, only
  -- last-touch is computable — every multi-touch model needs to know which
  -- touches belong together.
  add column if not exists journey_key text,
  add column if not exists source text,
  add column if not exists medium text,
  add column if not exists spend numeric(18,2) not null default 0,
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists attribution_journey_idx
  on public.attribution_touchpoints(brand_id, journey_key, occurred_at);
create index if not exists attribution_occurred_idx
  on public.attribution_touchpoints(brand_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 5. analytics_daily: link back to the account it came from
-- ---------------------------------------------------------------------------
alter table public.analytics_daily
  add column if not exists social_account_id uuid references public.social_accounts(id) on delete set null,
  add column if not exists ingested_at timestamptz not null default now();

create index if not exists analytics_daily_brand_date_idx
  on public.analytics_daily(brand_id, metric_date desc);

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.analytics_daily enable row level security;
alter table public.attribution_touchpoints enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.post_metrics enable row level security;
alter table public.analytics_ingestion_state enable row level security;
alter table public.optimization_recommendations enable row level security;

-- Measurements are read-only to tenants. A tenant that could write its own
-- analytics could manufacture the evidence its recommendations cite, which
-- would make the whole confidence/evidence mechanism worthless.
drop policy if exists "analytics daily read" on public.analytics_daily;
create policy "analytics daily read" on public.analytics_daily
  for select to authenticated
  using (public.can_access_brand(brand_id));

drop policy if exists "post metrics read" on public.post_metrics;
create policy "post metrics read" on public.post_metrics
  for select to authenticated
  using (public.can_access_brand(brand_id));

drop policy if exists "ingestion state read" on public.analytics_ingestion_state;
create policy "ingestion state read" on public.analytics_ingestion_state
  for select to authenticated
  using (public.can_access_brand(brand_id));

-- Touchpoints are the exception: a tenant's own site or CRM reports these, so
-- inserting them is legitimate. Updating or deleting a recorded conversion is
-- not — that would let observed history be rewritten after the fact.
drop policy if exists "attribution touchpoints read" on public.attribution_touchpoints;
create policy "attribution touchpoints read" on public.attribution_touchpoints
  for select to authenticated
  using (public.can_access_brand(brand_id));

drop policy if exists "attribution touchpoints insert" on public.attribution_touchpoints;
create policy "attribution touchpoints insert" on public.attribution_touchpoints
  for insert to authenticated
  with check (public.can_access_brand(brand_id));

-- Recommendations: readable by the tenant, and they may resolve one
-- (apply/dismiss). Creating them is the engine's job.
drop policy if exists "ai recommendations read" on public.ai_recommendations;
create policy "ai recommendations read" on public.ai_recommendations
  for select to authenticated
  using (public.can_access_brand(brand_id));

drop policy if exists "ai recommendations resolve" on public.ai_recommendations;
create policy "ai recommendations resolve" on public.ai_recommendations
  for update to authenticated
  using (public.can_access_brand(brand_id))
  with check (public.can_access_brand(brand_id));

drop policy if exists "optimization recommendations read" on public.optimization_recommendations;
create policy "optimization recommendations read" on public.optimization_recommendations
  for select to authenticated
  using (public.can_access_brand(brand_id));

-- ---------------------------------------------------------------------------
-- 7. Idempotent metric upserts
-- ---------------------------------------------------------------------------
-- Ingestion re-reads the last few days on every run, because platforms revise
-- recent numbers for up to 72 hours. That makes "write the same day twice" the
-- normal case, not an error — so the write has to be an upsert keyed on the
-- natural unique constraint, and it must be the LATER measurement that wins.
create or replace function public.upsert_daily_metrics(
  p_brand_id uuid,
  p_platform text,
  p_external_account_id text,
  p_metric_date date,
  p_social_account_id uuid,
  p_reach bigint,
  p_impressions bigint,
  p_engagements bigint,
  p_clicks bigint,
  p_conversions bigint,
  p_video_views bigint,
  p_spend numeric,
  p_revenue numeric,
  p_raw jsonb
)
returns public.analytics_daily
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.analytics_daily;
begin
  insert into public.analytics_daily (
    brand_id, platform, external_account_id, metric_date, social_account_id,
    reach, impressions, engagements, clicks, conversions, video_views,
    spend, revenue, raw_metrics, ingested_at
  ) values (
    p_brand_id, p_platform, p_external_account_id, p_metric_date, p_social_account_id,
    coalesce(p_reach, 0), coalesce(p_impressions, 0), coalesce(p_engagements, 0),
    coalesce(p_clicks, 0), coalesce(p_conversions, 0), coalesce(p_video_views, 0),
    coalesce(p_spend, 0), coalesce(p_revenue, 0), coalesce(p_raw, '{}'::jsonb), now()
  )
  on conflict (brand_id, platform, external_account_id, metric_date)
  do update set
    reach = excluded.reach,
    impressions = excluded.impressions,
    engagements = excluded.engagements,
    clicks = excluded.clicks,
    conversions = excluded.conversions,
    video_views = excluded.video_views,
    -- Spend and revenue may come from a different source than the platform
    -- insights (an ad account, the tenant's own commerce data). A zero from
    -- insights must not wipe a real figure recorded elsewhere.
    spend = greatest(public.analytics_daily.spend, excluded.spend),
    revenue = greatest(public.analytics_daily.revenue, excluded.revenue),
    raw_metrics = excluded.raw_metrics,
    ingested_at = now()
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.upsert_daily_metrics(uuid, text, text, date, uuid, bigint, bigint, bigint, bigint, bigint, bigint, numeric, numeric, jsonb)
  from public, anon, authenticated;

create or replace function public.upsert_post_metrics(
  p_brand_id uuid,
  p_social_post_id uuid,
  p_platform text,
  p_external_post_id text,
  p_snapshot_date date,
  p_published_at timestamptz,
  p_impressions bigint,
  p_reach bigint,
  p_engagements bigint,
  p_likes bigint,
  p_comments bigint,
  p_shares bigint,
  p_saves bigint,
  p_clicks bigint,
  p_video_views bigint,
  p_raw jsonb
)
returns public.post_metrics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_metrics;
begin
  insert into public.post_metrics (
    brand_id, social_post_id, platform, external_post_id, snapshot_date, published_at,
    impressions, reach, engagements, likes, comments, shares, saves, clicks, video_views,
    raw_metrics, updated_at
  ) values (
    p_brand_id, p_social_post_id, p_platform, p_external_post_id, p_snapshot_date, p_published_at,
    coalesce(p_impressions, 0), coalesce(p_reach, 0), coalesce(p_engagements, 0),
    coalesce(p_likes, 0), coalesce(p_comments, 0), coalesce(p_shares, 0),
    coalesce(p_saves, 0), coalesce(p_clicks, 0), coalesce(p_video_views, 0),
    coalesce(p_raw, '{}'::jsonb), now()
  )
  on conflict (brand_id, platform, external_post_id, snapshot_date)
  do update set
    social_post_id = coalesce(excluded.social_post_id, public.post_metrics.social_post_id),
    published_at = coalesce(excluded.published_at, public.post_metrics.published_at),
    impressions = excluded.impressions,
    reach = excluded.reach,
    engagements = excluded.engagements,
    likes = excluded.likes,
    comments = excluded.comments,
    shares = excluded.shares,
    saves = excluded.saves,
    clicks = excluded.clicks,
    video_views = excluded.video_views,
    raw_metrics = excluded.raw_metrics,
    updated_at = now()
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.upsert_post_metrics(uuid, uuid, text, text, date, timestamptz, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Recommendation refresh
-- ---------------------------------------------------------------------------
-- Regenerating recommendations must not stack duplicates, and must not silently
-- discard a recommendation the user already applied or dismissed. Keyed on
-- (brand, signal) among OPEN rows only, so a dismissed recommendation stays
-- dismissed until its signal is regenerated deliberately.
create or replace function public.upsert_recommendation(
  p_brand_id uuid,
  p_workspace_id uuid,
  p_signal text,
  p_title text,
  p_recommendation text,
  p_priority text,
  p_action_type text,
  p_confidence numeric,
  p_evidence jsonb,
  p_window_days integer,
  p_sample_size integer,
  p_generated_by text,
  p_model text
)
returns public.ai_recommendations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ai_recommendations;
begin
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'confidence must be between 0 and 1, got %', p_confidence;
  end if;

  -- Evidence is not optional. A recommendation the user cannot audit is
  -- indistinguishable from a fabricated one, so the database refuses it.
  if p_evidence is null or p_evidence = '{}'::jsonb then
    raise exception 'a recommendation must cite evidence';
  end if;

  update public.ai_recommendations
     set title = p_title,
         recommendation = p_recommendation,
         priority = p_priority,
         action_type = p_action_type,
         confidence = p_confidence,
         evidence = p_evidence,
         window_days = p_window_days,
         sample_size = p_sample_size,
         generated_by = p_generated_by,
         model = p_model,
         workspace_id = coalesce(p_workspace_id, workspace_id),
         updated_at = now()
   where brand_id = p_brand_id
     and signal = p_signal
     and status = 'open'
  returning * into v_row;

  if found then
    return v_row;
  end if;

  insert into public.ai_recommendations (
    brand_id, workspace_id, signal, title, recommendation, priority, action_type,
    confidence, evidence, window_days, sample_size, generated_by, model, status
  ) values (
    p_brand_id, p_workspace_id, p_signal, p_title, p_recommendation, p_priority, p_action_type,
    p_confidence, p_evidence, p_window_days, p_sample_size, p_generated_by, p_model, 'open'
  )
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.upsert_recommendation(uuid, uuid, text, text, text, text, text, numeric, jsonb, integer, integer, text, text)
  from public, anon, authenticated;
