-- OwBrand Phase 4
-- Autonomous marketing loop foundations.

create table if not exists public.content_calendar_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  platform text not null,
  format text not null,
  objective text,
  scheduled_for timestamptz,
  status text not null default 'draft',
  content_brief jsonb not null default '{}'::jsonb,
  generated_asset_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_recommendations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  priority text not null default 'medium',
  title text not null,
  reason text,
  action text not null,
  suggested_asset text,
  status text not null default 'open',
  source_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  task text not null,
  status text not null default 'queued',
  input_context jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists content_calendar_brand_schedule_idx
  on public.content_calendar_items(brand_id, scheduled_for);

create index if not exists marketing_recommendations_brand_status_idx
  on public.marketing_recommendations(brand_id, status);

create index if not exists ai_agent_runs_brand_created_idx
  on public.ai_agent_runs(brand_id, created_at);

alter table public.content_calendar_items enable row level security;
alter table public.marketing_recommendations enable row level security;
alter table public.ai_agent_runs enable row level security;

-- Apply the same workspace/brand membership policies used by the earlier migrations.
-- ai_agent_runs should be writable/readable only through authorized server-side flows.
