-- OwBrand Phase 5
-- Run My Marketing + approval policies + explainable execution.

create table if not exists public.marketing_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  status text not null default 'planned',
  automation_level text not null default 'assisted',
  input_context jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text
);

create table if not exists public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  automation_level text not null default 'assisted',
  auto_publish boolean not null default false,
  auto_create_ads boolean not null default true,
  auto_spend_money boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id)
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  marketing_run_id uuid references public.marketing_runs(id) on delete cascade,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  reviewer_id uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_actions (
  id uuid primary key default gen_random_uuid(),
  marketing_run_id uuid not null references public.marketing_runs(id) on delete cascade,
  action_type text not null,
  status text not null default 'planned',
  explanation text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists marketing_runs_brand_created_idx
  on public.marketing_runs(brand_id, created_at);

create index if not exists approval_requests_brand_status_idx
  on public.approval_requests(brand_id, status);

create index if not exists marketing_actions_run_status_idx
  on public.marketing_actions(marketing_run_id, status);

alter table public.marketing_runs enable row level security;
alter table public.approval_policies enable row level security;
alter table public.approval_requests enable row level security;
alter table public.marketing_actions enable row level security;

-- Reuse the existing brand/workspace membership policy model.
-- Worker-only mutation of publishing/spend actions must stay server-side.
