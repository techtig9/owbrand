-- ============================================================================
-- OwBrand — Row Level Security / tenant-isolation tests
-- ============================================================================
-- Runs against a database that has had the shim, schema.sql and every
-- migration applied. Impersonates real users the way PostgREST does — by
-- setting `role authenticated` and `request.jwt.claim.sub` — and asserts that
-- one tenant cannot see another's rows.
--
-- Output lines begin with PASS or FAIL so the shell harness can grade them.
-- ============================================================================

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

create temporary table _results (name text, passed boolean, detail text);

-- The suite switches into the `authenticated` / `anon` roles to exercise RLS,
-- so those roles must be able to record assertions. Grant on the temp schema
-- and table explicitly; temp objects are not covered by default privileges.
do $$
begin
  execute format('grant usage on schema %I to public', (select nspname from pg_namespace
    where oid = pg_my_temp_schema()));
  execute format('grant select, insert on %I._results to public', (select nspname from pg_namespace
    where oid = pg_my_temp_schema()));
end $$;

-- assert(name, actual, expected) — records a row rather than aborting, so one
-- failure does not hide the rest of the suite.
create or replace function pg_temp.assert_eq(p_name text, p_actual anyelement, p_expected anyelement)
returns void language plpgsql as $$
begin
  insert into _results
  values (p_name, p_actual is not distinct from p_expected,
          format('expected %s, got %s', p_expected, p_actual));
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two unrelated tenants, plus a third user who shares A's workspace.
-- ---------------------------------------------------------------------------
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'
\set user_c '33333333-3333-3333-3333-333333333333'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'user_a', 'a@owbrand.test', '{"full_name":"Alice"}'),
  (:'user_b', 'b@owbrand.test', '{"full_name":"Bob"}'),
  (:'user_c', 'c@owbrand.test', '{"full_name":"Cleo"}');

-- handle_new_user() created users/workspaces/subscriptions for each of them.

-- Alice's brand, in Alice's workspace.
insert into public.brands (id, user_id, workspace_id, name, description)
select 'aaaaaaaa-0000-0000-0000-000000000001', :'user_a', w.id, 'Alice Brand', 'a'
  from public.workspaces w where w.owner_id = :'user_a' limit 1;

-- Bob's brand, in Bob's workspace.
insert into public.brands (id, user_id, workspace_id, name, description)
select 'bbbbbbbb-0000-0000-0000-000000000001', :'user_b', w.id, 'Bob Brand', 'b'
  from public.workspaces w where w.owner_id = :'user_b' limit 1;

-- Cleo is a member of Alice's workspace (shared-access case).
insert into public.workspace_members (workspace_id, user_id, role)
select w.id, :'user_c', 'editor' from public.workspaces w where w.owner_id = :'user_a' limit 1
on conflict do nothing;

insert into public.products (id, brand_id, name, description)
values ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice Product', 'x'),
       ('bbbbbbbb-0000-0000-0000-0000000000b1'::uuid, 'bbbbbbbb-0000-0000-0000-000000000001', 'Bob Product', 'y');

insert into public.campaigns (id, brand_id, name, objective, status)
values ('aaaaaaaa-0000-0000-0000-0000000000a2'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice Campaign', 'sales', 'draft'),
       ('bbbbbbbb-0000-0000-0000-0000000000b2'::uuid, 'bbbbbbbb-0000-0000-0000-000000000001', 'Bob Campaign', 'sales', 'draft');

insert into public.content_assets (id, user_id, brand_id, type, status)
values ('aaaaaaaa-0000-0000-0000-0000000000a3'::uuid, :'user_a', 'aaaaaaaa-0000-0000-0000-000000000001', 'post', 'draft'),
       ('bbbbbbbb-0000-0000-0000-0000000000b3'::uuid, :'user_b', 'bbbbbbbb-0000-0000-0000-000000000001', 'post', 'draft');

insert into public.ai_recommendations (brand_id, title, recommendation, priority, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Alice rec', 'do a thing', 'high', 'open'),
       ('bbbbbbbb-0000-0000-0000-000000000001', 'Bob rec', 'do another', 'high', 'open');

-- ---------------------------------------------------------------------------
-- Schema-shape assertions (the migration collisions the audit found)
-- ---------------------------------------------------------------------------
select pg_temp.assert_eq(
  'schema: campaigns has both objective and goal',
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='campaigns' and column_name in ('objective','goal')), 2);

select pg_temp.assert_eq(
  'schema: products.workspace_id exists and is nullable',
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='workspace_id'), 'YES');

select pg_temp.assert_eq(
  'schema: subscriptions keeps user-scoped credit columns',
  (select count(*)::int from information_schema.columns
    where table_schema='public' and table_name='subscriptions'
      and column_name in ('user_id','credits_remaining','plan')), 3);

select pg_temp.assert_eq(
  'schema: webhook_events table exists',
  (select count(*)::int from information_schema.tables
    where table_schema='public' and table_name='webhook_events'), 1);

select pg_temp.assert_eq(
  'schema: email_logs table exists',
  (select count(*)::int from information_schema.tables
    where table_schema='public' and table_name='email_logs'), 1);

select pg_temp.assert_eq(
  'schema: ai_usage_logs table exists',
  (select count(*)::int from information_schema.tables
    where table_schema='public' and table_name='ai_usage_logs'), 1);

select pg_temp.assert_eq(
  'schema: audit_logs table exists',
  (select count(*)::int from information_schema.tables
    where table_schema='public' and table_name='audit_logs'), 1);

-- Every tenant-owned table that has RLS enabled must now have at least one
-- policy, except the deliberately worker-only ones.
select pg_temp.assert_eq(
  'rls: no tenant table is left enabled-with-no-policy',
  (select count(*)::int
     from pg_tables t
     left join (select schemaname, tablename, count(*) n from pg_policies group by 1,2) p
       on p.schemaname = t.schemaname and p.tablename = t.tablename
    where t.schemaname = 'public'
      and t.rowsecurity
      and coalesce(p.n, 0) = 0
      -- Worker-only tables: invisible to clients by design.
      and t.tablename not in ('webhook_events','publishing_jobs','marketing_actions','worker_heartbeats')
  ), 0);

-- Products insert must have derived workspace_id from the brand.
select pg_temp.assert_eq(
  'trigger: products.workspace_id derived from brand',
  (select count(*)::int from public.products where workspace_id is not null), 2);

-- Campaign alias sync must have populated `goal` from `objective`.
select pg_temp.assert_eq(
  'trigger: campaigns.goal synced from objective',
  (select count(*)::int from public.campaigns where goal is not null), 2);

-- ---------------------------------------------------------------------------
-- Tenant isolation — Alice
-- ---------------------------------------------------------------------------
-- NOTE: session-level SET, not SET LOCAL. psql runs in autocommit, so SET LOCAL
-- outside an explicit transaction silently does nothing — the suite would then
-- run as the bootstrap superuser, which has BYPASSRLS, and every isolation
-- assertion would pass without RLS ever being consulted.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.assert_eq('rls: Alice sees only her own brand',
  (select count(*)::int from public.brands), 1);
select pg_temp.assert_eq('rls: Alice cannot read Bob''s brand by id',
  (select count(*)::int from public.brands where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0);
select pg_temp.assert_eq('rls: Alice sees only her own products',
  (select count(*)::int from public.products), 1);
select pg_temp.assert_eq('rls: Alice cannot read Bob''s product',
  (select count(*)::int from public.products where name = 'Bob Product'), 0);
select pg_temp.assert_eq('rls: Alice sees only her own campaigns',
  (select count(*)::int from public.campaigns), 1);
select pg_temp.assert_eq('rls: Alice cannot read Bob''s campaign',
  (select count(*)::int from public.campaigns where name = 'Bob Campaign'), 0);
select pg_temp.assert_eq('rls: Alice sees only her own content assets',
  (select count(*)::int from public.content_assets), 1);
select pg_temp.assert_eq('rls: Alice cannot read Bob''s AI recommendations',
  (select count(*)::int from public.ai_recommendations where title = 'Bob rec'), 0);
select pg_temp.assert_eq('rls: Alice sees only her own subscription',
  (select count(*)::int from public.subscriptions), 1);

-- Writes into another tenant must be refused too, not just reads.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.products (brand_id, name) values ('bbbbbbbb-0000-0000-0000-000000000001', 'injected');
  exception when insufficient_privilege or check_violation then ok := true;
  end;
  insert into _results values ('rls: Alice cannot INSERT into Bob''s brand', ok,
    case when ok then 'blocked' else 'INSERT SUCCEEDED — tenant isolation broken' end);
end $$;

do $$
declare affected integer;
begin
  update public.brands set name = 'hijacked' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  insert into _results values ('rls: Alice cannot UPDATE Bob''s brand', affected = 0,
    format('%s rows updated', affected));
end $$;

do $$
declare affected integer;
begin
  delete from public.brands where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  insert into _results values ('rls: Alice cannot DELETE Bob''s brand', affected = 0,
    format('%s rows deleted', affected));
end $$;

-- ---------------------------------------------------------------------------
-- Tenant isolation — Bob (mirror image)
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.assert_eq('rls: Bob sees only his own brand',
  (select count(*)::int from public.brands), 1);
select pg_temp.assert_eq('rls: Bob cannot read Alice''s product',
  (select count(*)::int from public.products where name = 'Alice Product'), 0);
select pg_temp.assert_eq('rls: Bob cannot read Alice''s content assets',
  (select count(*)::int from public.content_assets where user_id = '11111111-1111-1111-1111-111111111111'), 0);

-- ---------------------------------------------------------------------------
-- Shared workspace — Cleo is a member of Alice's workspace
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select pg_temp.assert_eq('rls: workspace member CAN read the shared brand',
  (select count(*)::int from public.brands where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1);
select pg_temp.assert_eq('rls: workspace member CAN read the shared products',
  (select count(*)::int from public.products where brand_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1);
select pg_temp.assert_eq('rls: workspace member still cannot read Bob''s brand',
  (select count(*)::int from public.brands where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0);

-- ---------------------------------------------------------------------------
-- Anonymous access
-- ---------------------------------------------------------------------------
set role anon;
set request.jwt.claim.sub = '';

do $$
declare n integer := -1;
begin
  begin
    select count(*) into n from public.brands;
  exception when insufficient_privilege then n := 0;
  end;
  insert into _results values ('rls: anonymous cannot read any brand', n = 0, format('saw %s rows', n));
end $$;

do $$
declare n integer := -1;
begin
  begin
    select count(*) into n from public.subscriptions;
  exception when insufficient_privilege then n := 0;
  end;
  insert into _results values ('rls: anonymous cannot read subscriptions', n = 0, format('saw %s rows', n));
end $$;

-- ---------------------------------------------------------------------------
-- Worker-only tables must be invisible even to an authenticated user
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n integer := -1;
begin
  begin
    select count(*) into n from public.webhook_events;
  exception when insufficient_privilege then n := 0;
  end;
  insert into _results values ('rls: authenticated user cannot read webhook_events', n = 0, format('saw %s rows', n));
end $$;

-- ---------------------------------------------------------------------------
-- Credit integrity
-- ---------------------------------------------------------------------------
reset role;
reset request.jwt.claim.sub;

-- deduct is atomic and refuses to overdraw.
do $$
declare balance integer; ok boolean := false;
begin
  update public.subscriptions set credits_remaining = 100
   where user_id = '11111111-1111-1111-1111-111111111111';

  select public.deduct_credits('11111111-1111-1111-1111-111111111111', 40) into balance;
  insert into _results values ('credits: deduct reduces balance', balance = 60, format('balance %s', balance));

  begin
    perform public.deduct_credits('11111111-1111-1111-1111-111111111111', 1000);
  exception when others then ok := true;
  end;
  insert into _results values ('credits: cannot overdraw', ok,
    case when ok then 'raised insufficient_credits' else 'OVERDRAW ALLOWED' end);

  select credits_remaining into balance from public.subscriptions
   where user_id = '11111111-1111-1111-1111-111111111111';
  insert into _results values ('credits: failed deduct left balance intact', balance = 60, format('balance %s', balance));
end $$;

-- refund is capped at the plan ceiling (free = 500).
do $$
declare balance integer;
begin
  perform public.refund_credits('11111111-1111-1111-1111-111111111111', 999999);
  select credits_remaining into balance from public.subscriptions
   where user_id = '11111111-1111-1111-1111-111111111111';
  insert into _results values ('credits: refund capped at plan ceiling', balance <= 500, format('balance %s', balance));
end $$;

-- Non-negative constraint is enforced at the table level.
do $$
declare ok boolean := false;
begin
  begin
    update public.subscriptions set credits_remaining = -5
     where user_id = '11111111-1111-1111-1111-111111111111';
  exception when check_violation then ok := true;
  end;
  insert into _results values ('credits: negative balance rejected by constraint', ok,
    case when ok then 'constraint held' else 'NEGATIVE BALANCE ALLOWED' end);
end $$;

-- ---------------------------------------------------------------------------
-- Webhook idempotency
-- ---------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  insert into public.webhook_events (provider, event_id, event_type)
  values ('paddle', 'evt_test_1', 'transaction.completed');
  begin
    insert into public.webhook_events (provider, event_id, event_type)
    values ('paddle', 'evt_test_1', 'transaction.completed');
  exception when unique_violation then ok := true;
  end;
  insert into _results values ('billing: duplicate webhook event rejected', ok,
    case when ok then 'unique constraint held' else 'DUPLICATE ACCEPTED' end);
end $$;

-- ---------------------------------------------------------------------------
-- Storage path policy
-- ---------------------------------------------------------------------------
do $$
declare segs text[];
begin
  segs := storage.foldername('11111111-1111-1111-1111-111111111111/brand/product/file.png');
  insert into _results values ('storage: foldername extracts tenant segment',
    segs[1] = '11111111-1111-1111-1111-111111111111', array_to_string(segs, '/'));
end $$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
\set QUIET off
\pset tuples_only on
\pset format unaligned

select case when passed then 'PASS  ' else 'FAIL  ' end || name ||
       case when passed then '' else '   [' || detail || ']' end
  from _results order by ctid;

select format('SUMMARY %s/%s passed, %s failed',
              count(*) filter (where passed), count(*), count(*) filter (where not passed))
  from _results;

-- Non-zero exit when anything failed, so CI notices.
do $$
declare failures integer;
begin
  select count(*) into failures from _results where not passed;
  if failures > 0 then
    raise exception 'RLS_TESTS_FAILED: % assertion(s) failed', failures;
  end if;
end $$;
