-- OwBrand Phase 6
-- Production worker + OAuth connection metadata + execution audit.

create table if not exists public.social_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform text not null,
  external_account_id text,
  external_account_name text,
  token_secret_ref text not null,
  scopes jsonb not null default '[]'::jsonb,
  status text not null default 'connected',
  expires_at timestamptz,
  last_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, platform, external_account_id)
);

create table if not exists public.execution_audit_logs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  run_id uuid,
  action_id uuid,
  actor_type text not null default 'system',
  action text not null,
  status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.worker_heartbeats (
  id uuid primary key default gen_random_uuid(),
  worker_name text not null unique,
  status text not null default 'healthy',
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists oauth_connections_brand_platform_idx
  on public.social_oauth_connections(brand_id, platform);

create index if not exists execution_audit_brand_created_idx
  on public.execution_audit_logs(brand_id, created_at);

alter table public.social_oauth_connections enable row level security;
alter table public.execution_audit_logs enable row level security;
alter table public.worker_heartbeats enable row level security;

-- Token secret references must never be returned to untrusted browser clients.
-- Worker heartbeats and audit mutation should remain server-side.
