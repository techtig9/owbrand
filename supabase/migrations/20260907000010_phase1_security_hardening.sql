-- ============================================================================
-- OwBrand — Phase 1: security hardening, schema reconciliation, audit tables
-- ============================================================================
--
-- WHAT THIS FIXES
--
-- 1. COLLIDING DEFINITIONS. Three tables were declared twice with incompatible
--    shapes under `create table if not exists`, so the result depended on
--    execution order and, on an existing database, the second definition
--    silently did nothing while the application expected its columns:
--
--      campaigns    schema.sql: objective/start_at/end_at
--                   phase3:     goal/starts_at/ends_at
--      products     schema.sql: brand_id NOT NULL
--                   phase15:    workspace_id NOT NULL, approved_facts
--      subscriptions schema.sql: user_id/plan/credits_remaining
--                   phase8:      workspace_id/plan_id, no credits
--
--    schema.sql is treated as the source of truth because it is the shape the
--    running application actually reads and writes. The alternative shapes are
--    reconciled onto it additively — no column is dropped and no data is lost.
--
-- 2. RLS ENABLED WITH ZERO POLICIES. Roughly thirty tables had row level
--    security switched on and not a single policy written, which denies all
--    access to `authenticated` and made the service-role client the only way to
--    read anything. Tenant isolation therefore depended entirely on route code.
--    Every tenant-owned table now has explicit policies.
--
-- 3. MISSING AUDIT INFRASTRUCTURE: webhook_events (billing idempotency),
--    email_logs, ai_usage_logs and audit_logs did not exist.
--
-- 4. updated_at columns existed but nothing maintained them.
--
-- Idempotent throughout: safe to re-run.
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Shared helper functions
-- ---------------------------------------------------------------------------

-- Maintains updated_at on any table with that column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Is the current user a member (or owner) of this workspace?
-- SECURITY DEFINER so the policy can read workspace_members without recursing
-- through that table's own RLS policy.
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
     where w.id = p_workspace_id and w.owner_id = auth.uid()
  ) or exists (
    select 1 from public.workspace_members wm
     where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
  );
$$;

-- Can the current user reach this brand, as direct owner or via its workspace?
create or replace function public.can_access_brand(p_brand_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.brands b
     where b.id = p_brand_id
       and (b.user_id = auth.uid() or public.is_workspace_member(b.workspace_id))
  );
$$;

-- Is the current user an OwBrand admin?
create or replace function public.is_app_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin');
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.can_access_brand(uuid) from public;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_access_brand(uuid) to authenticated;
grant execute on function public.is_app_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reconcile the colliding table definitions
-- ---------------------------------------------------------------------------

-- 2a. campaigns ------------------------------------------------------------
-- Whichever definition won, guarantee both column sets exist so neither the
-- application (objective/start_at/end_at) nor the Phase 3 code (goal/starts_at/
-- ends_at) breaks, then keep them in step.
alter table public.campaigns add column if not exists objective text not null default 'awareness';
alter table public.campaigns add column if not exists goal text;
alter table public.campaigns add column if not exists start_at timestamptz;
alter table public.campaigns add column if not exists end_at timestamptz;
alter table public.campaigns add column if not exists starts_at timestamptz;
alter table public.campaigns add column if not exists ends_at timestamptz;
alter table public.campaigns add column if not exists brief jsonb not null default '{}'::jsonb;
alter table public.campaigns add column if not exists strategy jsonb not null default '{}'::jsonb;
alter table public.campaigns add column if not exists budget numeric(12,2);
alter table public.campaigns add column if not exists created_at timestamptz not null default now();
alter table public.campaigns add column if not exists updated_at timestamptz not null default now();

-- Backfill each alias from the other so existing rows are consistent.
update public.campaigns set goal = objective where goal is null;
update public.campaigns set starts_at = start_at where starts_at is null and start_at is not null;
update public.campaigns set ends_at = end_at where ends_at is null and end_at is not null;
update public.campaigns set start_at = starts_at where start_at is null and starts_at is not null;
update public.campaigns set end_at = ends_at where end_at is null and ends_at is not null;

-- `goal` was NOT NULL in the Phase 3 definition; relax it so inserts that only
-- supply `objective` (which is what the app does) succeed.
alter table public.campaigns alter column goal drop not null;

-- Keep the aliases synchronised from here on, in both directions.
create or replace function public.sync_campaign_aliases()
returns trigger
language plpgsql
as $$
begin
  if new.goal is null and new.objective is not null then new.goal := new.objective; end if;
  if new.objective is null and new.goal is not null then new.objective := new.goal; end if;
  if new.starts_at is null and new.start_at is not null then new.starts_at := new.start_at; end if;
  if new.start_at is null and new.starts_at is not null then new.start_at := new.starts_at; end if;
  if new.ends_at is null and new.end_at is not null then new.ends_at := new.end_at; end if;
  if new.end_at is null and new.ends_at is not null then new.end_at := new.ends_at; end if;
  return new;
end;
$$;

drop trigger if exists campaigns_sync_aliases on public.campaigns;
create trigger campaigns_sync_aliases
  before insert or update on public.campaigns
  for each row execute function public.sync_campaign_aliases();

-- 2b. products -------------------------------------------------------------
-- The Phase 15 definition required workspace_id NOT NULL, which would reject
-- every insert the application makes (it supplies brand_id). Add the extra
-- columns as nullable and derive workspace_id from the brand instead.
alter table public.products add column if not exists workspace_id uuid;
alter table public.products add column if not exists approved_facts jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists source_media jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
       and column_name = 'workspace_id' and is_nullable = 'NO'
  ) then
    alter table public.products alter column workspace_id drop not null;
  end if;
end $$;

update public.products p
   set workspace_id = b.workspace_id
  from public.brands b
 where p.brand_id = b.id and p.workspace_id is null;

-- Derive workspace_id automatically on write so the column stays useful
-- without the application having to know about it.
create or replace function public.derive_product_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.workspace_id is null and new.brand_id is not null then
    select b.workspace_id into new.workspace_id from public.brands b where b.id = new.brand_id;
  end if;
  return new;
end;
$$;

drop trigger if exists products_derive_workspace on public.products;
create trigger products_derive_workspace
  before insert or update on public.products
  for each row execute function public.derive_product_workspace();

-- 2c. subscriptions --------------------------------------------------------
-- The application's billing model is user-scoped with a credit balance. The
-- Phase 8 definition was workspace-scoped with no credits. Guarantee the
-- application's columns exist and are usable.
alter table public.subscriptions add column if not exists user_id uuid;
alter table public.subscriptions add column if not exists plan text;
alter table public.subscriptions add column if not exists plan_id text;
alter table public.subscriptions add column if not exists status text not null default 'active';
alter table public.subscriptions add column if not exists provider text not null default 'paddle';
alter table public.subscriptions add column if not exists paddle_subscription_id text;
alter table public.subscriptions add column if not exists paddle_customer_id text;
alter table public.subscriptions add column if not exists credits_remaining integer not null default 500;
alter table public.subscriptions add column if not exists renews_at timestamptz;
alter table public.subscriptions add column if not exists workspace_id uuid;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists current_period_start timestamptz;
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists created_at timestamptz not null default now();
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();

-- `plan` may be the plan_id ENUM (schema.sql) or TEXT (phase8), so the two
-- columns cannot be COALESCEd directly — "COALESCE types plan_id and text
-- cannot be matched". Cast through text and let the assignment cast back.
do $$
begin
  execute 'update public.subscriptions set plan_id = plan::text where plan_id is null and plan is not null';
  execute 'update public.subscriptions set plan = plan_id::text::' ||
          (select format_type(a.atttypid, null)
             from pg_attribute a
            where a.attrelid = 'public.subscriptions'::regclass and a.attname = 'plan') ||
          ' where plan is null and plan_id is not null';
  execute 'update public.subscriptions set plan_id = ''free'' where plan_id is null';
exception
  when others then
    raise warning 'subscriptions plan reconciliation skipped: %', sqlerrm;
end $$;

-- One subscription per user is what every query assumes.
create unique index if not exists subscriptions_user_id_key on public.subscriptions(user_id) where user_id is not null;
create index if not exists subscriptions_paddle_sub_idx on public.subscriptions(paddle_subscription_id);

-- 2d. product_assets -------------------------------------------------------
-- Columns the media routes write but the base schema did not declare.
alter table public.product_assets add column if not exists status text not null default 'uploaded';
alter table public.product_assets add column if not exists source text not null default 'user_upload';
alter table public.product_assets add column if not exists analysis jsonb not null default '{}'::jsonb;
alter table public.product_assets add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 3. New audit / operations tables
-- ---------------------------------------------------------------------------

-- 3a. Billing webhook idempotency.
-- The Paddle handler previously had no deduplication, so a replayed (validly
-- signed) event re-ran its side effects — including resetting a subscription's
-- credit balance to the plan maximum. The unique event_id makes replay a no-op.
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paddle',
  event_id text not null,
  event_type text not null,
  status text not null default 'processing',   -- processing | processed | failed | ignored
  payload_digest text,
  error text,
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);
create index if not exists webhook_events_type_idx on public.webhook_events(provider, event_type, received_at desc);

-- 3b. Email delivery audit. Bodies are never stored — only who/what/outcome.
create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  recipient text not null,
  template text not null,
  status text not null,                        -- sent | failed | skipped
  provider text not null default 'resend',
  provider_message_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists email_logs_user_template_idx on public.email_logs(user_id, template, created_at desc);
create index if not exists email_logs_status_idx on public.email_logs(status, created_at desc);

-- 3c. AI usage and cost, attributable per workspace / user / job.
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  workspace_id uuid,
  brand_id uuid references public.brands(id) on delete set null,
  job_id uuid,
  provider text not null,
  model text not null,
  task text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  latency_ms integer,
  status text not null default 'success',      -- success | failed | timeout | rate_limited
  error_code text,
  credits_charged integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_time_idx on public.ai_usage_logs(user_id, created_at desc);
create index if not exists ai_usage_workspace_time_idx on public.ai_usage_logs(workspace_id, created_at desc);

-- 3d. General audit log for privileged and security-relevant actions.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  actor_type text not null default 'user',     -- user | admin | system | webhook
  workspace_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  ip_hash text,                                -- hashed, never a raw address
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_actor_time_idx on public.audit_logs(actor_id, created_at desc);
create index if not exists audit_logs_action_time_idx on public.audit_logs(action, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'brand_profiles','brand_guidelines','products','product_assets','campaigns',
    'subscriptions','social_posts','content_calendar_items','approval_policies',
    'social_oauth_connections','support_tickets','brand_brains','campaigns_v2',
    'content_items'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        t || '_set_updated_at', t
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Performance indexes on hot paths
-- ---------------------------------------------------------------------------
create index if not exists content_assets_user_created_idx on public.content_assets(user_id, created_at desc);
create index if not exists content_assets_brand_status_idx on public.content_assets(brand_id, status);
create index if not exists scheduled_posts_due_idx on public.scheduled_posts(status, scheduled_at);
create index if not exists scheduled_posts_user_idx on public.scheduled_posts(user_id, scheduled_at desc);
create index if not exists brands_user_created_idx on public.brands(user_id, created_at desc);
create index if not exists social_accounts_user_platform_idx on public.social_accounts(user_id, platform);
create index if not exists ai_recommendations_brand_status_idx on public.ai_recommendations(brand_id, status, created_at desc);
create index if not exists payments_user_created_idx on public.payments(user_id, created_at desc);
create index if not exists approvals_brand_status_idx on public.approvals(brand_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------
-- Every tenant-owned table gets an explicit policy. The service-role key still
-- bypasses RLS (that is how Postgres works), so these policies are defence in
-- depth behind the application guards in src/lib/auth/guards.ts — not a
-- replacement for them.

-- 6a. Fix infinite recursion in the core policies -------------------------
--
-- supabase/schema.sql declared these two policies:
--
--   workspaces:        USING (owner_id = auth.uid() OR EXISTS (
--                        SELECT 1 FROM workspace_members WHERE ...))
--   workspace_members: USING (user_id = auth.uid() OR EXISTS (
--                        SELECT 1 FROM workspaces WHERE ...))
--
-- Each policy's subquery is itself subject to the other table's policy, so any
-- query touching either table recurses until PostgreSQL aborts with
-- "infinite recursion detected in policy for relation workspace_members".
-- In practice that means workspaces, workspace_members, and every brand-scoped
-- policy that joined through them were completely unusable for a normal
-- authenticated client.
--
-- The fix is to route membership checks through the SECURITY DEFINER helpers
-- defined above. Those execute as the function owner, which bypasses RLS
-- internally, so the check terminates instead of re-entering the policy.
drop policy if exists "workspace owner/member" on public.workspaces;
create policy "workspace owner/member" on public.workspaces
  for all to authenticated
  using (owner_id = auth.uid() or public.is_workspace_member(id))
  with check (owner_id = auth.uid());

drop policy if exists "workspace members own" on public.workspace_members;
create policy "workspace members own" on public.workspace_members
  for all to authenticated
  -- Non-recursive: reads its own row directly, or defers to the helper.
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Brand-scoped policies from schema.sql inline the same recursive subquery.
-- Restate them against the helpers.
drop policy if exists "brand owner" on public.brands;
create policy "brand owner" on public.brands
  for all to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id))
  with check (user_id = auth.uid() or public.is_workspace_member(workspace_id));

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('brand_profiles',      'brand_id'),
      ('brand_guidelines',    'brand_id'),
      ('brand_rules',         'brand_id'),
      ('content_calendar',    'brand_id'),
      ('approvals',           'brand_id'),
      ('campaigns',           'brand_id'),
      ('ad_accounts',         'brand_id'),
      ('analytics_snapshots', 'brand_id'),
      ('ai_recommendations',  'brand_id')
    ) as t(table_name, col)
  loop
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = spec.table_name
    ) then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I',
                   replace(spec.table_name, '_', ' ') || ' owner', spec.table_name);
    execute format('drop policy if exists "brand scoped" on public.%I', spec.table_name);
    execute format(
      'create policy "brand scoped" on public.%I for all to authenticated
         using (public.can_access_brand(%I)) with check (public.can_access_brand(%I))',
      spec.table_name, spec.col, spec.col
    );
  end loop;
end $$;

-- Named policies from schema.sql that the loop above cannot guess.
drop policy if exists "brand profiles owner" on public.brand_profiles;
drop policy if exists "brand guidelines owner" on public.brand_guidelines;
drop policy if exists "brand rules owner" on public.brand_rules;
drop policy if exists "calendar owner" on public.content_calendar;
drop policy if exists "approval owner" on public.approvals;
drop policy if exists "campaign owner" on public.campaigns;
drop policy if exists "ad account owner" on public.ad_accounts;
drop policy if exists "analytics owner" on public.analytics_snapshots;
drop policy if exists "recommendation owner" on public.ai_recommendations;

-- Tables reached through products, which is itself brand-scoped.
drop policy if exists "variants owner" on public.product_variants;
create policy "variants owner" on public.product_variants
  for all to authenticated
  using (exists (select 1 from public.products p
                  where p.id = product_id and public.can_access_brand(p.brand_id)))
  with check (exists (select 1 from public.products p
                  where p.id = product_id and public.can_access_brand(p.brand_id)));

drop policy if exists "product assets owner" on public.product_assets;
create policy "product assets owner" on public.product_assets
  for all to authenticated
  using (exists (select 1 from public.products p
                  where p.id = product_id and public.can_access_brand(p.brand_id)))
  with check (exists (select 1 from public.products p
                  where p.id = product_id and public.can_access_brand(p.brand_id)));

drop policy if exists "campaign assets owner" on public.campaign_assets;
create policy "campaign assets owner" on public.campaign_assets
  for all to authenticated
  using (exists (select 1 from public.campaigns c
                  where c.id = campaign_id and public.can_access_brand(c.brand_id)))
  with check (exists (select 1 from public.campaigns c
                  where c.id = campaign_id and public.can_access_brand(c.brand_id)));

-- User-scoped tables: add WITH CHECK so a client cannot insert a row owned by
-- somebody else (the original policies only constrained reads).
drop policy if exists "content owner" on public.content_assets;
create policy "content owner" on public.content_assets
  for all to authenticated
  using (user_id = auth.uid() or public.can_access_brand(brand_id))
  with check (user_id = auth.uid());

drop policy if exists "scheduled owner" on public.scheduled_posts;
create policy "scheduled owner" on public.scheduled_posts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "social owner" on public.social_accounts;
create policy "social owner" on public.social_accounts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "jobs owner" on public.ai_jobs;
create policy "jobs owner" on public.ai_jobs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "users own" on public.users;
create policy "users own" on public.users
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Billing rows are read-only to their owner; only the service role writes them.
drop policy if exists "subscription read" on public.subscriptions;
create policy "subscription read" on public.subscriptions
  for select to authenticated using (user_id = auth.uid() or public.is_app_admin());

drop policy if exists "payments read" on public.payments;
create policy "payments read" on public.payments
  for select to authenticated using (user_id = auth.uid() or public.is_app_admin());

drop policy if exists "deployment owner" on public.deployments;
create policy "deployment owner" on public.deployments
  for select to authenticated using (public.can_access_brand(project_id));

-- Enable RLS on the new tables.
alter table public.webhook_events enable row level security;
alter table public.email_logs     enable row level security;
alter table public.ai_usage_logs  enable row level security;
alter table public.audit_logs     enable row level security;

-- webhook_events is worker-only: no policy at all means no client can read it.
-- (Intentional — this is the one table where "RLS on, no policy" is correct.)

-- A user may read their own email and AI usage history; nobody may write from
-- the client. Writes happen through the service role only.
drop policy if exists "email logs own read" on public.email_logs;
create policy "email logs own read" on public.email_logs
  for select to authenticated using (user_id = auth.uid() or public.is_app_admin());

drop policy if exists "ai usage own read" on public.ai_usage_logs;
create policy "ai usage own read" on public.ai_usage_logs
  for select to authenticated using (user_id = auth.uid() or public.is_app_admin());

drop policy if exists "audit logs own read" on public.audit_logs;
create policy "audit logs own read" on public.audit_logs
  for select to authenticated using (actor_id = auth.uid() or public.is_app_admin());

-- Phase 3–8 and Phase 15 tables: brand-scoped read/write for members.
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('campaign_tasks',                'campaign'),
      ('social_posts',                  'brand'),
      ('publishing_jobs',               'worker'),
      ('social_insights',               'brand'),
      ('content_calendar_items',        'brand'),
      ('marketing_recommendations',     'brand'),
      ('ai_agent_runs',                 'brand'),
      ('marketing_runs',                'brand'),
      ('approval_policies',             'brand'),
      ('approval_requests',             'brand'),
      ('marketing_actions',             'worker'),
      ('social_oauth_connections',      'brand_no_secrets'),
      ('execution_audit_logs',          'brand_read'),
      ('worker_heartbeats',             'worker'),
      ('analytics_daily',               'brand_read'),
      ('attribution_touchpoints',       'brand_read'),
      ('optimization_recommendations',  'brand')
    ) as t(table_name, mode)
  loop
    -- Skip tables that do not exist in this database.
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = spec.table_name
    ) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', spec.table_name);
    execute format('drop policy if exists "tenant access" on public.%I', spec.table_name);

    if spec.mode = 'brand' then
      execute format(
        'create policy "tenant access" on public.%I for all to authenticated
           using (public.can_access_brand(brand_id))
           with check (public.can_access_brand(brand_id))',
        spec.table_name
      );

    elsif spec.mode = 'brand_read' then
      -- Ingested/derived data: readable by members, written only server-side.
      execute format(
        'create policy "tenant access" on public.%I for select to authenticated
           using (public.can_access_brand(brand_id))',
        spec.table_name
      );

    elsif spec.mode = 'brand_no_secrets' then
      -- OAuth connection metadata. Readable so the UI can show account health;
      -- the token reference column is never selected by client code, and all
      -- mutation is server-side.
      execute format(
        'create policy "tenant access" on public.%I for select to authenticated
           using (public.can_access_brand(brand_id))',
        spec.table_name
      );

    elsif spec.mode = 'campaign' then
      execute format(
        'create policy "tenant access" on public.%I for all to authenticated
           using (exists (select 1 from public.campaigns c
                           where c.id = campaign_id and public.can_access_brand(c.brand_id)))
           with check (exists (select 1 from public.campaigns c
                           where c.id = campaign_id and public.can_access_brand(c.brand_id)))',
        spec.table_name
      );

    elsif spec.mode = 'worker' then
      -- No policy: worker-only tables stay invisible to every browser client.
      null;
    end if;
  end loop;
end $$;

-- Phase 8 workspace-scoped tables.
do $$
declare
  t text;
begin
  foreach t in array array['usage_events','notifications','support_tickets','audit_events'] loop
    if not exists (
      select 1 from information_schema.tables where table_schema = 'public' and table_name = t
    ) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "tenant access" on public.%I', t);

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      execute format(
        'create policy "tenant access" on public.%I for select to authenticated
           using (user_id = auth.uid()
                  or (workspace_id is not null and public.is_workspace_member(workspace_id))
                  or public.is_app_admin())',
        t
      );
    else
      execute format(
        'create policy "tenant access" on public.%I for select to authenticated
           using ((workspace_id is not null and public.is_workspace_member(workspace_id))
                  or public.is_app_admin())',
        t
      );
    end if;
  end loop;
end $$;

-- Phase 15 workspace-scoped tables.
do $$
declare
  t text;
begin
  foreach t in array array['brand_brains','generation_jobs','campaigns_v2','content_items','media_assets','notification_events'] loop
    if not exists (
      select 1 from information_schema.tables where table_schema = 'public' and table_name = t
    ) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "tenant access" on public.%I', t);
    execute format(
      'create policy "tenant access" on public.%I for all to authenticated
         using (public.is_workspace_member(workspace_id))
         with check (public.is_workspace_member(workspace_id))',
      t
    );
  end loop;
end $$;

-- The Phase 15 `products` table shares a name with the core one; make sure the
-- core brand-scoped policy is the one in force.
drop policy if exists "products owner" on public.products;
create policy "products owner" on public.products
  for all to authenticated
  using (public.can_access_brand(brand_id))
  with check (public.can_access_brand(brand_id));

-- ---------------------------------------------------------------------------
-- 7. Credit integrity
-- ---------------------------------------------------------------------------

-- A balance must never go negative, whatever calls the RPCs.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_credits_non_negative'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_credits_non_negative check (credits_remaining >= 0);
  end if;
end $$;

-- refund_credits was previously uncapped, so repeated refunds could inflate a
-- balance above the plan allowance. Cap it at the recorded plan ceiling.
--
-- schema.sql declared it `returns void`; CREATE OR REPLACE cannot change a
-- return type, so the old signature is dropped first.
drop function if exists public.refund_credits(uuid, integer);

create or replace function public.refund_credits(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
  ceiling integer;
begin
  if p_amount is null or p_amount <= 0 then
    select credits_remaining into new_balance from public.subscriptions where user_id = p_user_id;
    return new_balance;
  end if;

  select coalesce(max(credits_cap), 2147483647) into ceiling
    from (select case plan
                   when 'free'     then 500
                   when 'starter'  then 10000
                   when 'pro'      then 30000
                   when 'business' then 75000
                   else 2147483647
                 end as credits_cap
            from public.subscriptions where user_id = p_user_id) s;

  update public.subscriptions
     set credits_remaining = least(credits_remaining + p_amount, ceiling)
   where user_id = p_user_id
  returning credits_remaining into new_balance;

  return new_balance;
end;
$$;

-- deduct_credits is already atomic (the WHERE clause guards the balance);
-- restated here so a fresh database gets the hardened version regardless of
-- which files were applied.
drop function if exists public.deduct_credits(uuid, integer);

create or replace function public.deduct_credits(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid_amount';
  end if;

  if p_amount = 0 then
    select credits_remaining into new_balance from public.subscriptions where user_id = p_user_id;
    return new_balance;
  end if;

  update public.subscriptions
     set credits_remaining = credits_remaining - p_amount
   where user_id = p_user_id
     and credits_remaining >= p_amount
  returning credits_remaining into new_balance;

  if new_balance is null then
    raise exception 'insufficient_credits';
  end if;

  return new_balance;
end;
$$;

revoke all on function public.deduct_credits(uuid, integer) from public, anon, authenticated;
revoke all on function public.refund_credits(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Storage: enforce the tenant path convention
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('owbrand-media', 'owbrand-media', false)
on conflict (id) do update set public = false;

drop policy if exists "owbrand media upload" on storage.objects;
drop policy if exists "owbrand media read"   on storage.objects;
drop policy if exists "owbrand media update" on storage.objects;
drop policy if exists "owbrand media delete" on storage.objects;

create policy "owbrand media upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'owbrand-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owbrand media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'owbrand-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owbrand media update" on storage.objects
  for update to authenticated
  using (bucket_id = 'owbrand-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owbrand media delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'owbrand-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 9. Signup trigger — make it idempotent and resilient
-- ---------------------------------------------------------------------------
-- The original raised on any conflict, which would fail the whole auth signup
-- transaction and leave a user in auth.users with no application rows.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  insert into public.users(id, name, email, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    'user'
  )
  on conflict (id) do nothing;

  insert into public.workspaces(owner_id, name)
  values (new.id, 'My Workspace')
  returning id into v_workspace_id;

  if v_workspace_id is not null then
    insert into public.workspace_members(workspace_id, user_id, role)
    values (v_workspace_id, new.id, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  end if;

  insert into public.subscriptions(user_id, plan, plan_id, status, credits_remaining)
  values (new.id, 'free', 'free', 'active', 500)
  on conflict (user_id) do nothing;

  return new;
exception
  when others then
    -- Never block account creation on provisioning. The application backfills
    -- a missing subscription row on first use.
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
