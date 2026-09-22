-- ============================================================================
-- Phase 7: account deletion and export.
--
-- Idempotent. Two foreign keys change their ON DELETE behaviour; no data is
-- altered or dropped.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. payments must SURVIVE a user deletion
-- ----------------------------------------------------------------------------
-- `payments.user_id` was `on delete cascade`, so deleting an account destroyed
-- its payment history. That is not merely inconvenient — the privacy policy
-- states that billing records are retained for tax and accounting purposes,
-- and most jurisdictions require exactly that for years after the customer
-- relationship ends. A deletion feature built on the existing cascade would
-- have quietly destroyed records the business is obliged to keep, and nobody
-- would have noticed until an audit.
--
-- Changed to `set null`: the row survives with its amount, status, Paddle
-- transaction id and date, and loses the link to the person. That is the shape
-- retention actually wants — the figures are needed, the identity is not.

alter table public.payments
  drop constraint if exists payments_user_id_fkey;

-- Nullable, because the whole point is that the row outlives the user.
alter table public.payments
  alter column user_id drop not null;

alter table public.payments
  add constraint payments_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

comment on column public.payments.user_id is
  'Null once the account is deleted. The row is retained for tax and '
  'accounting purposes with the identity removed.';

-- ----------------------------------------------------------------------------
-- 2. approvals.reviewer_id would BLOCK a user deletion
-- ----------------------------------------------------------------------------
-- It had no ON DELETE clause at all, which defaults to NO ACTION — so deleting
-- any user who had ever reviewed an approval failed with a foreign key
-- violation. The deletion feature would have worked in testing (fresh accounts
-- have reviewed nothing) and failed for exactly the long-standing accounts
-- most likely to request deletion.

alter table public.approvals
  drop constraint if exists approvals_reviewer_id_fkey;

alter table public.approvals
  add constraint approvals_reviewer_id_fkey
  foreign key (reviewer_id) references public.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 3. Deletion as one atomic function
-- ----------------------------------------------------------------------------
-- In the database rather than the application, because a deletion that fails
-- halfway is the worst possible outcome: the user is told their data is gone
-- while some of it remains, and there is no way to tell which. One transaction
-- either removes everything or nothing.
--
-- The audit row is written BEFORE the delete. Afterwards, `audit_logs.actor_id`
-- would be set to null by its own cascade and the record of who was deleted
-- would be lost along with the account — so the order is not cosmetic.
create or replace function public.delete_user_account(p_user_id uuid, p_reason text default 'user_request')
returns table (
  deleted boolean,
  brands_removed integer,
  payments_retained integer,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_brands integer;
  v_payments integer;
  v_is_last_admin boolean;
begin
  select email into v_email from public.users where id = p_user_id;

  if v_email is null then
    return query select false, 0, 0, 'no such user'::text;
    return;
  end if;

  -- Refuse to delete the last remaining admin. Locking everybody out of the
  -- admin panel is not a recoverable mistake from inside the product, and a
  -- deletion request is exactly the moment somebody does it by accident.
  select (
    (select role from public.users where id = p_user_id) = 'admin'
    and (select count(*) from public.users where role = 'admin') <= 1
  ) into v_is_last_admin;

  if v_is_last_admin then
    return query select false, 0, 0, 'refusing to delete the only admin account'::text;
    return;
  end if;

  select count(*) into v_brands from public.brands where user_id = p_user_id;
  select count(*) into v_payments from public.payments where user_id = p_user_id;

  -- Before the delete: see the note above.
  insert into public.audit_logs (actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    p_user_id,
    'user',
    'account.deleted',
    'user',
    p_user_id::text,
    jsonb_build_object(
      'reason', p_reason,
      'brands_removed', v_brands,
      'payments_retained', v_payments,
      -- The email is recorded so a deletion can be evidenced if disputed.
      -- Keeping it is a deliberate trade-off against erasing every trace, and
      -- it is the minimum a retention obligation needs.
      'email_domain', split_part(v_email, '@', 2)
    )
  );

  -- Everything else follows the foreign keys: brands, workspaces, credits,
  -- onboarding, referrals and social accounts cascade; authored rows keep
  -- their content with the author set to null.
  delete from public.users where id = p_user_id;

  return query select true, v_brands, v_payments, null::text;
end;
$$;

-- Service role only. A tenant-callable deletion function is an account-deletion
-- primitive that takes an arbitrary uuid.
revoke all on function public.delete_user_account(uuid, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Missing foreign-key indexes
-- ----------------------------------------------------------------------------
-- Every one of these is an unindexed foreign key, which makes both the join and
-- the cascade a sequential scan. The cascade matters most here: deleting a user
-- touches each referencing table, and without these the deletion above would
-- scan them all.
create index if not exists approvals_reviewer_idx on public.approvals(reviewer_id);
create index if not exists brand_brain_versions_created_by_idx on public.brand_brain_versions(created_by);
create index if not exists product_facts_verified_by_idx on public.product_facts(verified_by);
create index if not exists content_factuality_resolved_by_idx on public.content_factuality(resolved_by);
create index if not exists site_revisions_created_by_idx on public.site_revisions(created_by);
create index if not exists asset_versions_created_by_idx on public.asset_versions(created_by);
create index if not exists feedback_user_idx on public.feedback(user_id);
create index if not exists referrals_referred_idx on public.referrals(referred_id);
create index if not exists deployments_project_idx on public.deployments(project_id);
create index if not exists payments_user_idx on public.payments(user_id);
create index if not exists email_logs_user_idx on public.email_logs(user_id);
create index if not exists ai_usage_logs_user_idx on public.ai_usage_logs(user_id);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
create index if not exists credit_ledger_user_idx on public.credit_ledger(user_id);
