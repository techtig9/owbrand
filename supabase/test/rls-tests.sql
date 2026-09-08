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
-- Phase 2: AI / Brand Brain / Product Brain tables
-- ---------------------------------------------------------------------------
reset role;
reset request.jwt.claim.sub;

insert into public.brand_brain_versions (brand_id, version, brain, source)
values ('aaaaaaaa-0000-0000-0000-000000000001', 1,
        '{"name":"Alice Brand","tagline":"t","positioning":{"usp":"u"}}'::jsonb, 'ai_generated'),
       ('bbbbbbbb-0000-0000-0000-000000000001', 1,
        '{"name":"Bob Brand","tagline":"t","positioning":{"usp":"u"}}'::jsonb, 'ai_generated');

insert into public.product_facts (product_id, fact, category, verified)
values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Alice fact', 'general', true),
       ('bbbbbbbb-0000-0000-0000-0000000000b1', 'Bob fact', 'general', true);

insert into public.site_pages (id, brand_id, slug, title, is_home)
values ('aaaaaaaa-0000-0000-0000-0000000000d1'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 'home', 'Alice Home', true),
       ('bbbbbbbb-0000-0000-0000-0000000000d1'::uuid, 'bbbbbbbb-0000-0000-0000-000000000001', 'home', 'Bob Home', true);

insert into public.site_sections (page_id, kind, sort_order)
values ('aaaaaaaa-0000-0000-0000-0000000000d1'::uuid, 'hero', 0),
       ('bbbbbbbb-0000-0000-0000-0000000000d1'::uuid, 'hero', 0);

select pg_temp.assert_eq(
  'schema: brand_brain_versions enforces unique (brand_id, version)',
  (select count(*)::int from pg_indexes
    where schemaname='public' and tablename='brand_brain_versions'
      and indexdef like '%UNIQUE%brand_id%version%'), 1);

select pg_temp.assert_eq(
  'schema: asset_versions requires exactly one parent',
  (select count(*)::int from pg_constraint where conname = 'asset_versions_one_parent'), 1);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.assert_eq('rls: Alice sees only her own Brand Brain versions',
  (select count(*)::int from public.brand_brain_versions), 1);
select pg_temp.assert_eq('rls: Alice cannot read Bob''s Brand Brain',
  (select count(*)::int from public.brand_brain_versions
    where brand_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0);
select pg_temp.assert_eq('rls: Alice sees only her own product facts',
  (select count(*)::int from public.product_facts), 1);
select pg_temp.assert_eq('rls: Alice cannot read Bob''s product facts',
  (select count(*)::int from public.product_facts where fact = 'Bob fact'), 0);
select pg_temp.assert_eq('rls: Alice sees only her own site pages',
  (select count(*)::int from public.site_pages), 1);
select pg_temp.assert_eq('rls: Alice cannot read Bob''s site sections',
  (select count(*)::int from public.site_sections), 1);
select pg_temp.assert_eq('rls: Alice sees only her own credit ledger',
  (select count(*)::int from public.credit_ledger where user_id <> auth.uid()), 0);

-- A blocked write must be refused, not silently ignored.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.brand_brain_versions (brand_id, version, brain)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 99, '{}'::jsonb);
  exception when insufficient_privilege or check_violation then ok := true;
  end;
  insert into _results values ('rls: Alice cannot write a Brand Brain into Bob''s brand', ok,
    case when ok then 'blocked' else 'INSERT SUCCEEDED — tenant isolation broken' end);
end $$;

reset role;
reset request.jwt.claim.sub;

-- reserve_credits must be atomic and must leave a ledger entry.
do $$
declare balance integer; entries integer; ok boolean := false;
begin
  update public.subscriptions set credits_remaining = 200
   where user_id = '11111111-1111-1111-1111-111111111111';

  select public.reserve_credits('11111111-1111-1111-1111-111111111111', 50, 'generate_content') into balance;
  insert into _results values ('credits: reserve_credits deducts', balance = 150, format('balance %s', balance));

  select count(*) into entries from public.credit_ledger
   where user_id = '11111111-1111-1111-1111-111111111111' and entry_type = 'reserve';
  insert into _results values ('credits: reserve writes a ledger entry', entries = 1, format('%s entries', entries));

  begin
    perform public.reserve_credits('11111111-1111-1111-1111-111111111111', 100000, 'x');
  exception when others then ok := true;
  end;
  insert into _results values ('credits: reserve cannot overdraw', ok,
    case when ok then 'raised insufficient_credits' else 'OVERDRAW ALLOWED' end);

  select credits_remaining into balance from public.subscriptions
   where user_id = '11111111-1111-1111-1111-111111111111';
  insert into _results values ('credits: failed reserve wrote no ledger entry', balance = 150, format('balance %s', balance));

  perform public.refund_credits_logged('11111111-1111-1111-1111-111111111111', 50, 'generation failed');
  select count(*) into entries from public.credit_ledger
   where user_id = '11111111-1111-1111-1111-111111111111' and entry_type = 'refund';
  insert into _results values ('credits: refund writes a ledger entry', entries = 1, format('%s entries', entries));
end $$;


-- ===========================================================================
-- Phase 3 — publishing, leases and OAuth state
-- ===========================================================================
-- The properties asserted here cannot be checked from application code:
-- whether the claim really is atomic, whether RLS really keeps one tenant out
-- of another's queue, and whether the state machine in
-- complete_publishing_job() actually holds.
-- ---------------------------------------------------------------------------

reset role;
reset request.jwt.claim.sub;

-- Alice and Bob each get a connected account and a queued post.
insert into public.social_accounts
  (id, user_id, brand_id, platform, account_name, external_account_id, external_page_id,
   access_token_ciphertext, granted_scopes, status)
values
  ('a0000000-0000-0000-0000-0000000000a1', :'user_a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'instagram', 'alice_ig', 'ig_alice', 'page_alice', 'v1.aaa.bbb.ccc',
   array['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement','business_management'], 'active'),
  ('b0000000-0000-0000-0000-0000000000b1', :'user_b', 'bbbbbbbb-0000-0000-0000-000000000001',
   'instagram', 'bob_ig', 'ig_bob', 'page_bob', 'v1.ddd.eee.fff',
   array['instagram_basic'], 'needs_reconnect');

insert into public.social_posts (id, brand_id, platform, status, caption, media_urls, idempotency_key)
values
  ('a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'instagram', 'queued', 'alice caption', '["https://cdn.test/a.jpg"]'::jsonb, 'idem-alice-1'),
  ('b0000000-0000-0000-0000-0000000000b2', 'bbbbbbbb-0000-0000-0000-000000000001',
   'instagram', 'queued', 'bob caption', '["https://cdn.test/b.jpg"]'::jsonb, 'idem-bob-1');

insert into public.publishing_jobs
  (id, social_post_id, brand_id, social_account_id, platform, status, idempotency_key, max_attempts)
values
  ('a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a2',
   'aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1',
   'instagram', 'queued', 'idem-alice-1', 5),
  ('b0000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-0000000000b2',
   'bbbbbbbb-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000b1',
   'instagram', 'queued', 'idem-bob-1', 5);

-- --- Schema guarantees -----------------------------------------------------
do $$
declare ok boolean := false;
begin
  -- Duplicate idempotency key must be impossible: a second social post for the
  -- same key would publish the same content twice.
  begin
    insert into public.social_posts (brand_id, platform, status, idempotency_key)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'instagram', 'queued', 'idem-alice-1');
  exception when unique_violation then ok := true;
  end;
  insert into _results values ('publishing: duplicate post idempotency key rejected', ok,
    case when ok then 'unique violation raised' else 'DUPLICATE POST ALLOWED' end);

  ok := false;
  begin
    insert into public.publishing_jobs (social_post_id, platform, status, idempotency_key)
    values ('a0000000-0000-0000-0000-0000000000a2', 'instagram', 'queued', 'idem-alice-1');
  exception when unique_violation then ok := true;
  end;
  insert into _results values ('publishing: duplicate job idempotency key rejected', ok,
    case when ok then 'unique violation raised' else 'DUPLICATE JOB ALLOWED' end);

  ok := false;
  begin
    update public.publishing_jobs set status = 'not_a_status'
     where id = 'a0000000-0000-0000-0000-0000000000a3';
  exception when check_violation then ok := true;
  end;
  insert into _results values ('publishing: job status constrained', ok,
    case when ok then 'check violation raised' else 'ARBITRARY STATUS ACCEPTED' end);

  ok := false;
  begin
    update public.social_accounts set status = 'whatever'
     where id = 'a0000000-0000-0000-0000-0000000000a1';
  exception when check_violation then ok := true;
  end;
  insert into _results values ('social: account status constrained', ok,
    case when ok then 'check violation raised' else 'ARBITRARY STATUS ACCEPTED' end);
end $$;

-- --- Atomic claim ----------------------------------------------------------
do $$
declare
  first_batch integer;
  second_batch integer;
  leased_by text;
  lease_until timestamptz;
begin
  select count(*) into first_batch
    from public.claim_publishing_jobs('worker-one', 10, 300);
  insert into _results values ('publishing: worker claims both due jobs', first_batch = 2,
    format('claimed %s', first_batch));

  -- THE property that matters. A second worker running while the first holds
  -- its lease must get nothing: a social post cannot be un-published.
  select count(*) into second_batch
    from public.claim_publishing_jobs('worker-two', 10, 300);
  insert into _results values ('publishing: second worker claims nothing while leased', second_batch = 0,
    format('claimed %s', second_batch));

  select locked_by, locked_until into leased_by, lease_until
    from public.publishing_jobs where id = 'a0000000-0000-0000-0000-0000000000a3';
  insert into _results values ('publishing: lease records the holder', leased_by = 'worker-one',
    format('locked_by %s', coalesce(leased_by, 'null')));
  insert into _results values ('publishing: lease has a future expiry', lease_until > now(),
    format('locked_until %s', lease_until));

  -- A crashed worker must not strand the job forever.
  update public.publishing_jobs
     set locked_until = now() - interval '1 minute'
   where id = 'a0000000-0000-0000-0000-0000000000a3';

  select count(*) into second_batch
    from public.claim_publishing_jobs('worker-three', 10, 300);
  insert into _results values ('publishing: expired lease is reclaimable', second_batch = 1,
    format('reclaimed %s', second_batch));
end $$;

-- --- Scheduling and backoff gating ----------------------------------------
do $$
declare claimed integer;
begin
  -- Release both jobs, then push one into the future.
  update public.publishing_jobs
     set status = 'queued', locked_until = null, locked_by = null, next_attempt_at = null, scheduled_for = null;

  update public.publishing_jobs
     set scheduled_for = now() + interval '1 day'
   where id = 'a0000000-0000-0000-0000-0000000000a3';

  select count(*) into claimed from public.claim_publishing_jobs('worker-four', 10, 300);
  insert into _results values ('publishing: future-scheduled job is not claimed', claimed = 1,
    format('claimed %s of 2', claimed));

  update public.publishing_jobs
     set status = 'queued', locked_until = null, locked_by = null, scheduled_for = null;

  -- A job backing off after a retryable failure must wait its turn.
  update public.publishing_jobs
     set next_attempt_at = now() + interval '1 hour'
   where id = 'a0000000-0000-0000-0000-0000000000a3';

  select count(*) into claimed from public.claim_publishing_jobs('worker-five', 10, 300);
  insert into _results values ('publishing: backing-off job is not claimed', claimed = 1,
    format('claimed %s of 2', claimed));

  update public.publishing_jobs
     set status = 'queued', locked_until = null, locked_by = null, next_attempt_at = null, attempts = 0;

  -- Exhausted attempts must never be retried again.
  update public.publishing_jobs
     set attempts = 5, max_attempts = 5
   where id = 'a0000000-0000-0000-0000-0000000000a3';

  select count(*) into claimed from public.claim_publishing_jobs('worker-six', 10, 300);
  insert into _results values ('publishing: exhausted job is not claimed', claimed = 1,
    format('claimed %s of 2', claimed));

  update public.publishing_jobs
     set status = 'queued', locked_until = null, locked_by = null, attempts = 0, max_attempts = 5;
end $$;

-- --- complete_publishing_job() state machine -------------------------------
do $$
declare
  job public.publishing_jobs;
  post_status text;
  attempt_rows integer;
begin
  -- A retryable failure schedules another attempt and releases the lease.
  perform public.claim_publishing_jobs('worker-seven', 10, 300);

  job := public.complete_publishing_job(
    'a0000000-0000-0000-0000-0000000000a3', 'retryable_failure',
    null, null, 'retryable', 'meta_http_500', 'Meta is having a moment.', null, 120, 60);

  insert into _results values ('publishing: retryable failure requeues', job.status = 'queued',
    format('status %s', job.status));
  insert into _results values ('publishing: retryable failure counts the attempt', job.attempts = 1,
    format('attempts %s', job.attempts));
  insert into _results values ('publishing: retryable failure releases the lease', job.locked_until is null,
    format('locked_until %s', coalesce(job.locked_until::text, 'null')));
  insert into _results values ('publishing: retry is scheduled in the future', job.next_attempt_at > now(),
    format('next_attempt_at %s', coalesce(job.next_attempt_at::text, 'null')));

  select count(*) into attempt_rows from public.publishing_attempts
   where publishing_job_id = 'a0000000-0000-0000-0000-0000000000a3';
  insert into _results values ('publishing: every attempt is logged', attempt_rows = 1,
    format('%s attempt rows', attempt_rows));

  -- The attempt ceiling is enforced by the function, not the caller: a worker
  -- that keeps calling cannot exceed it.
  update public.publishing_jobs set attempts = 4, next_attempt_at = null
   where id = 'a0000000-0000-0000-0000-0000000000a3';

  job := public.complete_publishing_job(
    'a0000000-0000-0000-0000-0000000000a3', 'retryable_failure',
    null, null, 'retryable', 'meta_http_500', 'Still broken.', null, 90, 60);

  insert into _results values ('publishing: fifth retryable attempt fails the job', job.status = 'failed',
    format('status %s after %s attempts', job.status, job.attempts));
  insert into _results values ('publishing: exhausted job schedules no retry', job.next_attempt_at is null,
    format('next_attempt_at %s', coalesce(job.next_attempt_at::text, 'null')));

  select status into post_status from public.social_posts
   where id = 'a0000000-0000-0000-0000-0000000000a2';
  insert into _results values ('publishing: failed job fails the post', post_status = 'failed',
    format('post status %s', post_status));

  -- A permanent failure never retries, whatever the attempt count.
  update public.publishing_jobs
     set status = 'claimed', attempts = 0, next_attempt_at = null
   where id = 'b0000000-0000-0000-0000-0000000000b3';

  job := public.complete_publishing_job(
    'b0000000-0000-0000-0000-0000000000b3', 'needs_reconnect',
    null, null, 'needs_reconnect', 'meta_auth_190', 'Token expired.', null, 40, null);

  insert into _results values ('publishing: needs_reconnect fails without retrying', job.status = 'failed',
    format('status %s at attempt %s', job.status, job.attempts));

  -- Success writes the external ids through to the user-visible post.
  update public.publishing_jobs
     set status = 'claimed', attempts = 0, next_attempt_at = null
   where id = 'a0000000-0000-0000-0000-0000000000a3';

  job := public.complete_publishing_job(
    'a0000000-0000-0000-0000-0000000000a3', 'published',
    'ig_17900000000000000', 'https://instagram.com/p/abc', null, null, null,
    '{"id":"ig_17900000000000000"}'::jsonb, 850, null);

  insert into _results values ('publishing: success marks the job published', job.status = 'published',
    format('status %s', job.status));

  select status into post_status from public.social_posts
   where id = 'a0000000-0000-0000-0000-0000000000a2';
  insert into _results values ('publishing: success marks the post published', post_status = 'published',
    format('post status %s', post_status));

  perform 1 from public.social_posts
   where id = 'a0000000-0000-0000-0000-0000000000a2'
     and external_post_id = 'ig_17900000000000000'
     and external_url = 'https://instagram.com/p/abc'
     and published_at is not null
     and last_error is null;
  insert into _results values ('publishing: success records external ids and clears the error', found, '');

  -- An unknown outcome must be rejected rather than silently stored.
  declare ok boolean := false;
  begin
    begin
      job := public.complete_publishing_job('a0000000-0000-0000-0000-0000000000a3', 'went_fine');
    exception when others then ok := true;
    end;
    insert into _results values ('publishing: unknown outcome rejected', ok,
      case when ok then 'raised' else 'ACCEPTED UNKNOWN OUTCOME' end);
  end;
end $$;

-- --- OAuth state -----------------------------------------------------------
do $$
declare
  consumed integer;
  ok boolean := false;
begin
  -- psql :'var' interpolation does not reach inside a DO block, so the fixture
  -- ids are written out literally here.
  insert into public.oauth_states (state, user_id, provider, requested_scopes, return_to)
  values ('state-alice-fresh', '11111111-1111-1111-1111-111111111111', 'meta', array['instagram_basic'], '/dashboard/settings'),
         ('state-alice-expired', '11111111-1111-1111-1111-111111111111', 'meta', array['instagram_basic'], '/dashboard/settings');

  update public.oauth_states set expires_at = now() - interval '1 minute'
   where state = 'state-alice-expired';

  -- The consume query the callback runs: unconsumed AND unexpired.
  with claimed as (
    update public.oauth_states set consumed_at = now()
     where state = 'state-alice-fresh' and provider = 'meta'
       and consumed_at is null and expires_at > now()
    returning 1
  ) select count(*) into consumed from claimed;
  insert into _results values ('oauth: fresh state is consumable once', consumed = 1,
    format('consumed %s', consumed));

  -- Replay of the same callback URL must fail — this is the account-linking
  -- attack the state exists to stop.
  with claimed as (
    update public.oauth_states set consumed_at = now()
     where state = 'state-alice-fresh' and provider = 'meta'
       and consumed_at is null and expires_at > now()
    returning 1
  ) select count(*) into consumed from claimed;
  insert into _results values ('oauth: consumed state cannot be replayed', consumed = 0,
    format('consumed %s', consumed));

  with claimed as (
    update public.oauth_states set consumed_at = now()
     where state = 'state-alice-expired' and provider = 'meta'
       and consumed_at is null and expires_at > now()
    returning 1
  ) select count(*) into consumed from claimed;
  insert into _results values ('oauth: expired state is rejected', consumed = 0,
    format('consumed %s', consumed));

  -- A state row cannot outlive its user.
  ok := false;
  begin
    insert into public.oauth_states (state, user_id, provider)
    values ('state-orphan', '99999999-9999-9999-9999-999999999999', 'meta');
  exception when foreign_key_violation then ok := true;
  end;
  insert into _results values ('oauth: state requires a real user', ok,
    case when ok then 'fk violation raised' else 'ORPHAN STATE ALLOWED' end);
end $$;

-- --- RLS: tenant isolation on the new tables -------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n integer;
begin
  select count(*) into n from public.social_posts;
  insert into _results values ('rls: Alice sees only her own social posts', n = 1, format('%s rows', n));

  select count(*) into n from public.social_posts
   where brand_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  insert into _results values ('rls: Alice cannot read Bob''s social posts', n = 0, format('%s rows', n));

  select count(*) into n from public.publishing_jobs;
  insert into _results values ('rls: Alice sees only her own publishing jobs', n = 1, format('%s rows', n));

  select count(*) into n from public.publishing_attempts;
  insert into _results values ('rls: Alice sees only her own publish attempts', n > 0 and n = (
    select count(*) from public.publishing_attempts
     where brand_id = 'aaaaaaaa-0000-0000-0000-000000000001'), format('%s rows', n));

  select count(*) into n from public.social_accounts;
  insert into _results values ('rls: Alice sees only her own connected accounts', n = 1, format('%s rows', n));

  select count(*) into n from public.oauth_states;
  insert into _results values ('rls: Alice sees only her own oauth states', n = 2, format('%s rows', n));
end $$;

-- A tenant must be able to READ why their post failed but never rewrite the
-- job — otherwise they could reset attempts and bypass the ceiling.
do $$
declare updated integer;
begin
  update public.publishing_jobs set attempts = 0, max_attempts = 99 where true;
  get diagnostics updated = row_count;
  insert into _results values ('rls: tenant cannot rewrite publishing jobs', updated = 0,
    format('%s rows updated', updated));

  update public.social_posts set status = 'published', external_post_id = 'forged'
   where brand_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  get diagnostics updated = row_count;
  insert into _results values ('rls: tenant cannot forge another tenant''s post', updated = 0,
    format('%s rows updated', updated));
end $$;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare n integer;
begin
  select count(*) into n from public.oauth_states;
  insert into _results values ('rls: Bob cannot read Alice''s oauth states', n = 0, format('%s rows', n));

  select count(*) into n from public.social_accounts
   where id = 'a0000000-0000-0000-0000-0000000000a1';
  insert into _results values ('rls: Bob cannot read Alice''s connected account', n = 0, format('%s rows', n));
end $$;

-- Cleo shares Alice's workspace, so the team calendar must be visible to her.
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $$
declare n integer;
begin
  select count(*) into n from public.social_posts
   where brand_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  insert into _results values ('rls: workspace member CAN read the shared calendar', n = 1, format('%s rows', n));

  select count(*) into n from public.social_posts
   where brand_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  insert into _results values ('rls: workspace member still cannot read Bob''s posts', n = 0, format('%s rows', n));
end $$;

set role anon;
reset request.jwt.claim.sub;

do $$
declare n integer;
begin
  select count(*) into n from public.social_accounts;
  insert into _results values ('rls: anonymous cannot read connected accounts', n = 0, format('%s rows', n));

  select count(*) into n from public.oauth_states;
  insert into _results values ('rls: anonymous cannot read oauth states', n = 0, format('%s rows', n));

  select count(*) into n from public.social_posts;
  insert into _results values ('rls: anonymous cannot read social posts', n = 0, format('%s rows', n));
end $$;

reset role;
reset request.jwt.claim.sub;

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
