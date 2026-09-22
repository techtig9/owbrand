-- ============================================================================
-- Phase 9: feature flags and admin credit grants.
--
-- Idempotent. New tables only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Feature flags
-- ----------------------------------------------------------------------------
-- The master command requires that incomplete features stay hidden behind
-- flags. Until now "behind a flag" meant an environment variable, which needs
-- a redeploy to change and cannot be varied per account — so a beta feature
-- was all-or-nothing and turning one off during an incident meant a deploy.
--
-- `enabled_for` holds user ids for a targeted rollout. It is deliberately a
-- plain array rather than a percentage: a percentage rollout that rehashes on
-- every request moves users in and out of a feature between page loads, and
-- debugging "it worked a minute ago" costs more than the feature is worth at
-- this scale.
create table if not exists public.feature_flags (
  key text primary key,
  description text not null default '',
  -- The global default when a user is not in enabled_for.
  enabled boolean not null default false,
  enabled_for uuid[] not null default '{}',
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'feature_flags' and policyname = 'feature_flags_read') then
    -- Readable by any signed-in user, because the client needs to know which
    -- features to render. Writable only by the service role: a tenant-writable
    -- flag table is a tenant-controlled feature set.
    create policy feature_flags_read on public.feature_flags
      for select to authenticated using (true);
  end if;
end;
$$;

revoke insert, update, delete on public.feature_flags from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2. Admin credit grants
-- ----------------------------------------------------------------------------
-- Support needs to be able to make a customer whole after an incident. Doing
-- it with a direct UPDATE on subscriptions leaves no record of who granted
-- what or why, which is the first question asked when the numbers are audited.
--
-- This wraps the grant in a function that writes BOTH the ledger entry and the
-- audit row in one transaction, so a grant cannot exist without its reason.
create or replace function public.grant_credits(
  p_admin_id uuid,
  p_user_id uuid,
  p_amount integer,
  p_reason text
)
returns table (granted boolean, new_balance integer, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_is_admin boolean;
begin
  -- The caller's admin role is re-checked HERE and not only in the route.
  -- A privileged function that trusts its caller's claim about themselves is
  -- one route bug away from being a self-service credit machine.
  select (role = 'admin') into v_is_admin from public.users where id = p_admin_id;
  if not coalesce(v_is_admin, false) then
    return query select false, 0, 'not an admin'::text;
    return;
  end if;

  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000 then
    -- Bounded in both directions. An unbounded grant is an unbounded liability,
    -- and a typo of 100000 is easier to make than to notice.
    return query select false, 0, 'amount must be non-zero and within +/-10000'::text;
    return;
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 then
    -- A grant without a reason is the one thing an audit cannot reconstruct.
    return query select false, 0, 'a reason is required'::text;
    return;
  end if;

  update public.subscriptions
     set credits_remaining = greatest(0, credits_remaining + p_amount),
         updated_at = now()
   where user_id = p_user_id
  returning credits_remaining into v_balance;

  if v_balance is null then
    return query select false, 0, 'no subscription for that user'::text;
    return;
  end if;

  insert into public.credit_ledger (user_id, entry_type, amount, balance_after, action, reason)
  values (
    p_user_id,
    -- 'adjust', not 'adjustment': credit_ledger_entry_type_check allows
    -- ('reserve','refund','grant','reset','adjust'). The first draft used the
    -- longer word and the constraint rejected it, which is the constraint
    -- doing its job — an unconstrained column would have accepted a value
    -- nothing else in the codebase knows how to read.
    case when p_amount > 0 then 'grant' else 'adjust' end,
    p_amount,
    v_balance,
    'admin_grant',
    p_reason
  );

  insert into public.audit_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    p_admin_id,
    'admin',
    'credits.granted',
    'user',
    p_user_id::text,
    jsonb_build_object('amount', p_amount, 'reason', p_reason, 'balance_after', v_balance)
  );

  return query select true, v_balance, null::text;
end;
$$;

revoke all on function public.grant_credits(uuid, uuid, integer, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Seed the flags the product actually checks
-- ----------------------------------------------------------------------------
-- Listed here rather than created on first use, so the admin screen shows the
-- full set from the start. A flag that only appears once something reads it is
-- a flag nobody knows they can turn on.
insert into public.feature_flags (key, description, enabled)
values
  ('public_api', 'The read-only /api/v1 endpoints and API key management.', true),
  ('webhooks', 'Outbound webhooks and endpoint management.', true),
  ('consistency_check', 'The brand-consistency checker on the Brand Kit page.', true),
  ('content_calendar', 'The month calendar view.', true),
  ('brand_kit_export', 'Brand kit download as a zip archive.', true),
  ('public_demo', 'The unauthenticated landing-page demo.', true)
on conflict (key) do nothing;
