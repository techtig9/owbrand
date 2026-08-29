-- OwBrand Phase 7
-- Analytics normalization, attribution and optimization recommendations.

create table if not exists public.analytics_daily (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform text not null,
  external_account_id text,
  metric_date date not null,
  reach bigint not null default 0,
  impressions bigint not null default 0,
  engagements bigint not null default 0,
  clicks bigint not null default 0,
  conversions bigint not null default 0,
  video_views bigint not null default 0,
  spend numeric(18,2) not null default 0,
  revenue numeric(18,2) not null default 0,
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (brand_id, platform, external_account_id, metric_date)
);

create table if not exists public.attribution_touchpoints (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform text not null,
  social_post_id uuid references public.social_posts(id) on delete set null,
  external_event_id text,
  occurred_at timestamptz not null,
  clicks bigint not null default 0,
  conversions bigint not null default 0,
  revenue numeric(18,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (brand_id, external_event_id)
);

create table if not exists public.optimization_recommendations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  priority text not null,
  action text not null,
  reason text not null,
  expected_impact text,
  source_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists analytics_daily_brand_date_idx
  on public.analytics_daily(brand_id, metric_date);

create index if not exists attribution_brand_time_idx
  on public.attribution_touchpoints(brand_id, occurred_at);

create index if not exists optimization_brand_status_idx
  on public.optimization_recommendations(brand_id, status);

alter table public.analytics_daily enable row level security;
alter table public.attribution_touchpoints enable row level security;
alter table public.optimization_recommendations enable row level security;

-- Analytics ingestion should be server-side.
-- Brand/workspace membership policies should mirror the existing RLS model.
