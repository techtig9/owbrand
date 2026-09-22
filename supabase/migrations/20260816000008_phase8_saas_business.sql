-- OwBrand Phase 8
-- SaaS commercial layer: subscriptions, usage, members, roles, notifications and support.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  plan_id text not null default 'free',
  provider text,
  external_subscription_id text,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  user_id uuid,
  metric text not null,
  quantity integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workspace_id uuid,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  user_id uuid not null,
  subject text not null,
  description text not null,
  priority text not null default 'normal',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  user_id uuid,
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Phase 1 fix: `subscriptions` is also declared in supabase/schema.sql with a
-- user-scoped shape, so the `create table if not exists` above is a no-op on
-- any database that has the base schema — and this index then failed with
-- `column "workspace_id" does not exist`, aborting the migration. Reconcile the
-- column explicitly before indexing it.
alter table public.subscriptions add column if not exists workspace_id uuid;
alter table public.subscriptions add column if not exists plan_id text;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists current_period_start timestamptz;
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists created_at timestamptz not null default now();
alter table public.subscriptions add column if not exists updated_at timestamptz not null default now();

create index if not exists subscriptions_workspace_idx on public.subscriptions(workspace_id);
create index if not exists usage_events_workspace_metric_idx on public.usage_events(workspace_id, metric, created_at);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create index if not exists notifications_user_read_idx on public.notifications(user_id, read_at);
create index if not exists support_tickets_workspace_status_idx on public.support_tickets(workspace_id, status);
create index if not exists audit_events_workspace_created_idx on public.audit_events(workspace_id, created_at);

alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.workspace_members enable row level security;
alter table public.notifications enable row level security;
alter table public.support_tickets enable row level security;
alter table public.audit_events enable row level security;

-- Apply workspace membership RLS policies using the project's existing auth model.
-- Billing provider webhooks and usage writes should be server-side.
