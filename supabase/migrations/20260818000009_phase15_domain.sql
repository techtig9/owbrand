-- OwBrand Phase 15: persistent domain state.
-- Adapt foreign-key columns to the project's existing workspace/user UUID schema
-- if those base tables use different identifiers.

create table if not exists public.brand_brains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  identity jsonb not null default '{}'::jsonb,
  voice jsonb not null default '{}'::jsonb,
  audience jsonb not null default '{}'::jsonb,
  visual_rules jsonb not null default '{}'::jsonb,
  guardrails jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid references public.brand_brains(id) on delete set null,
  name text not null,
  description text,
  approved_facts jsonb not null default '{}'::jsonb,
  source_media jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  idempotency_key text not null,
  type text not null,
  state text not null default 'queued',
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create table if not exists public.campaigns_v2 (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  objective text,
  audience jsonb not null default '{}'::jsonb,
  product_ids jsonb not null default '[]'::jsonb,
  platforms jsonb not null default '[]'::jsonb,
  content_mix jsonb not null default '{}'::jsonb,
  automation_level text not null default 'approval_required',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid references public.campaigns_v2(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  platform text,
  asset jsonb not null default '{}'::jsonb,
  copy jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  scheduled_at timestamptz,
  published_at timestamptz,
  external_post_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid references public.products(id) on delete cascade,
  kind text not null,
  storage_key text not null,
  mime_type text,
  width integer,
  height integer,
  duration_seconds numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists brand_brains_workspace_idx on public.brand_brains(workspace_id);
create index if not exists products_workspace_idx on public.products(workspace_id);
create index if not exists generation_jobs_workspace_state_idx on public.generation_jobs(workspace_id, state);
create index if not exists campaigns_v2_workspace_status_idx on public.campaigns_v2(workspace_id, status);
create index if not exists content_items_workspace_schedule_idx on public.content_items(workspace_id, scheduled_at);
create index if not exists media_assets_workspace_product_idx on public.media_assets(workspace_id, product_id);
create index if not exists notification_events_workspace_time_idx on public.notification_events(workspace_id, created_at);

alter table public.brand_brains enable row level security;
alter table public.products enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.campaigns_v2 enable row level security;
alter table public.content_items enable row level security;
alter table public.media_assets enable row level security;
alter table public.notification_events enable row level security;

-- IMPORTANT: install tenant-membership RLS policies using the project's
-- authenticated-user membership function before production data is exposed.
