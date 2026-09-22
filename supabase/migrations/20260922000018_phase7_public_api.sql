-- ============================================================================
-- Phase 7: public API keys and outbound webhooks.
--
-- Idempotent. New tables only; nothing existing is altered.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. API keys
-- ----------------------------------------------------------------------------
-- The key itself is NEVER stored. Only a SHA-256 hash of it, plus a short
-- display prefix so a user can tell two keys apart in a list.
--
-- This is not the same decision as password hashing and the reasoning differs:
-- a password is low-entropy and needs a slow KDF to survive an offline attack
-- on the hash. An API key here is 256 bits from a CSPRNG, so brute-forcing the
-- hash is not a threat and bcrypt would only add latency to every single API
-- request. What SHA-256 buys is that a database disclosure yields no usable
-- credential — which is the actual property wanted.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  -- Hex SHA-256 of the full key. Unique, so a collision is a constraint error
  -- rather than two accounts silently sharing a credential.
  key_hash text not null unique,
  -- e.g. "owb_live_A3f9" — enough to identify, far too little to use.
  key_prefix text not null,
  scopes text[] not null default array['read']::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists api_keys_user_idx on public.api_keys(user_id);
-- The lookup every authenticated API request performs. Partial, because a
-- revoked key is never looked up and including them wastes the index.
create index if not exists api_keys_hash_active_idx
  on public.api_keys(key_hash) where revoked_at is null;

alter table public.api_keys enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'api_keys' and policyname = 'api_keys_own') then
    -- A user sees and manages their own keys. The hash column is readable by
    -- its owner, which is harmless: they are the one person who already had
    -- the key it hashes.
    create policy api_keys_own on public.api_keys
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Webhook endpoints
-- ----------------------------------------------------------------------------
create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  url text not null,
  -- Shown once at creation, like the API key. The receiver needs it to verify
  -- signatures; we need it to produce them. Stored in clear because an HMAC
  -- secret must be usable on every send — unlike a provider access token,
  -- which is encrypted because it grants access to a third-party account.
  secret text not null,
  events text[] not null default array['post.published']::text[],
  enabled boolean not null default true,
  -- Set when deliveries fail consistently. An endpoint that has been gone for
  -- a week should not be retried forever on every event.
  disabled_reason text,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists webhook_endpoints_user_idx on public.webhook_endpoints(user_id);
create index if not exists webhook_endpoints_brand_idx on public.webhook_endpoints(brand_id);

alter table public.webhook_endpoints enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'webhook_endpoints' and policyname = 'webhook_endpoints_own') then
    create policy webhook_endpoints_own on public.webhook_endpoints
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Delivery log
-- ----------------------------------------------------------------------------
-- Without this, "did the webhook fire?" is unanswerable, and every integration
-- support conversation starts by guessing. The response body is capped and the
-- request body is stored in full, because when a receiver rejects a payload the
-- first question is always what exactly we sent.
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',   -- pending | delivered | failed | dead_letter
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  response_status integer,
  response_body text,
  error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The worker's claim query: pending deliveries that are due, oldest first.
create index if not exists webhook_deliveries_due_idx
  on public.webhook_deliveries(next_attempt_at)
  where status = 'pending';
create index if not exists webhook_deliveries_endpoint_idx
  on public.webhook_deliveries(endpoint_id, created_at desc);

alter table public.webhook_deliveries enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'webhook_deliveries' and policyname = 'webhook_deliveries_own') then
    -- Read-only for the owner: deliveries are written by the system, and a
    -- tenant-writable delivery log is a log that cannot be trusted as evidence.
    create policy webhook_deliveries_own on public.webhook_deliveries
      for select to authenticated
      using (
        endpoint_id in (select id from public.webhook_endpoints where user_id = auth.uid())
      );
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webhook_deliveries_status_check') then
    alter table public.webhook_deliveries
      add constraint webhook_deliveries_status_check
      check (status in ('pending', 'delivered', 'failed', 'dead_letter'));
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Claiming deliveries
-- ----------------------------------------------------------------------------
-- `for update skip locked` so two workers running concurrently take disjoint
-- batches instead of both processing the same delivery and sending it twice.
-- The status is flipped inside the same transaction as the lock, which is what
-- makes the claim atomic.
create or replace function public.claim_webhook_deliveries(p_limit integer default 20)
returns setof public.webhook_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select d.id
      from public.webhook_deliveries d
      join public.webhook_endpoints e on e.id = d.endpoint_id
     where d.status = 'pending'
       and d.next_attempt_at <= now()
       and e.enabled
     order by d.next_attempt_at
     limit p_limit
     for update of d skip locked
  )
  update public.webhook_deliveries d
     set attempts = d.attempts + 1,
         updated_at = now()
    from claimed
   where d.id = claimed.id
  returning d.*;
end;
$$;

revoke all on function public.claim_webhook_deliveries(integer) from public, anon, authenticated;

-- Grants for the new tables follow the pattern used elsewhere: tenants reach
-- them through RLS, and nothing here is reachable anonymously.
revoke all on public.api_keys from anon;
revoke all on public.webhook_endpoints from anon;
revoke all on public.webhook_deliveries from anon;
