-- ============================================================================
-- Minimal Supabase compatibility shim — TEST HARNESS ONLY.
-- ============================================================================
-- Recreates just enough of a hosted Supabase project (the auth and storage
-- schemas, the three Postgres roles, and auth.uid()) that supabase/schema.sql
-- and supabase/migrations/*.sql can be applied verbatim to a stock PostgreSQL
-- instance and their RLS policies exercised for real.
--
-- This file is NEVER applied to a Supabase project — hosted projects already
-- provide all of it. It exists so CI and local development can prove tenant
-- isolation instead of assuming it.
-- ============================================================================

-- Roles that Supabase provides out of the box.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS is what makes the service-role key able to ignore policies.
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

-- auth.users — only the columns the application and its triggers touch.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- auth.uid() reads the request-scoped claim, exactly as Supabase does. Tests
-- set it with `set local request.jwt.claim.sub = '<uuid>'` to impersonate a
-- user, which is precisely how PostgREST supplies it in production.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- storage.buckets / storage.objects, plus storage.foldername().
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  -- Supabase returns the path segments excluding the final filename.
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Table privileges. RLS still applies on top of these for anon/authenticated;
-- service_role bypasses RLS via its BYPASSRLS attribute.
--
-- `alter default privileges` covers tables created AFTER this runs, which is
-- what we want for schema.sql and the migrations. Supabase also grants on
-- everything already present, so grant_supabase_roles() below is called again
-- at the end of the harness to match that behaviour exactly.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- Idempotently grants table privileges the way a hosted Supabase project does.
-- Called after the migrations so anon/authenticated can *attempt* a query and
-- be judged by RLS, rather than being stopped earlier by a missing GRANT (which
-- would make an isolation test pass for the wrong reason).
create or replace function public.grant_supabase_roles()
returns void
language plpgsql
as $$
begin
  execute 'grant select, insert, update, delete on all tables in schema public to authenticated';
  execute 'grant select on all tables in schema public to anon';
  execute 'grant all on all tables in schema public to service_role';
  execute 'grant usage, select on all sequences in schema public to authenticated, service_role';
end $$;
