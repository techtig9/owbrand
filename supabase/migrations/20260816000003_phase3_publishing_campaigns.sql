-- OwBrand Phase 3
-- Publishing + campaign orchestration foundations.
-- Run after Phase 1/2 migrations.

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  goal text not null,
  status text not null default 'draft',
  brief jsonb not null default '{}'::jsonb,
  strategy jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  task_type text not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  scheduled_for timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  platform text not null,
  status text not null default 'draft',
  caption text,
  media_urls jsonb not null default '[]'::jsonb,
  scheduled_for timestamptz,
  published_at timestamptz,
  external_post_id text,
  external_url text,
  last_error text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  social_post_id uuid not null references public.social_posts(id) on delete cascade,
  platform text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  idempotency_key text not null unique,
  scheduled_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.social_insights (
  id uuid primary key default gen_random_uuid(),
  social_account_id uuid,
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform text not null,
  metric_date date not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (brand_id, platform, metric_date)
);

create index if not exists campaigns_brand_id_idx on public.campaigns(brand_id);
create index if not exists campaign_tasks_campaign_id_idx on public.campaign_tasks(campaign_id);
create index if not exists social_posts_brand_status_idx on public.social_posts(brand_id, status);
create index if not exists publishing_jobs_status_schedule_idx on public.publishing_jobs(status, scheduled_for);
create index if not exists social_insights_brand_date_idx on public.social_insights(brand_id, metric_date);

alter table public.campaigns enable row level security;
alter table public.campaign_tasks enable row level security;
alter table public.social_posts enable row level security;
alter table public.publishing_jobs enable row level security;
alter table public.social_insights enable row level security;

-- Application-specific membership policies should be added alongside the existing
-- workspace/brand RLS model. Worker-only tables must not be client-readable.
