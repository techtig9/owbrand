-- ============================================================================
-- Closes two gaps the audit found. Idempotent; alters nothing destructively.
--
--  1. media_jobs and product_asset_versions had RLS DISABLED and no policies.
--  2. Four SECURITY DEFINER functions kept the default PUBLIC EXECUTE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Two orphan tables with row level security switched off
-- ----------------------------------------------------------------------------
-- Both were created by 20260816_phase2.sql and then superseded:
--   media_jobs             → generation_jobs        (20260907000011)
--   product_asset_versions → asset_versions         (20260907000011)
-- No application code references either name -- `grep -rn` over src returns
-- nothing -- so they hold no rows and never have.
--
-- That is not the same as harmless. With RLS off, Supabase's default grants to
-- `anon` and `authenticated` make both tables fully readable and writable
-- through PostgREST by anyone with the public anon key and a session. And
-- because media_jobs carries foreign keys to users, brands, products and
-- product_assets, an INSERT with a guessed brand_id distinguishes "exists"
-- from "does not exist" by whether the FK violates -- an existence oracle for
-- another tenant's identifiers, from a table nothing is watching.
--
-- They are kept rather than dropped: the operating rules forbid destructive
-- changes to existing tables, and a DROP cannot be rolled back if some
-- deployment did write to them. Locked down instead, and labelled so the next
-- person does not mistake the absent policies for an oversight.

alter table if exists public.media_jobs enable row level security;
alter table if exists public.product_asset_versions enable row level security;

-- Deliberately NO policies. RLS with an empty policy set denies every
-- tenant-role request, while the service role still bypasses RLS entirely --
-- which is the correct posture for a table no user session should ever touch.
--
-- RLS is the control that matters here, and the revoke below is only a second
-- layer. That ordering is not a style preference: a Supabase project applies
-- blanket `grant select, insert, update, delete on all tables in schema public
-- to authenticated`, and anything that re-runs those grants -- a later
-- migration, the dashboard, `supabase db reset` -- silently restores the
-- privilege this statement removes. The database test suite proved exactly
-- that: the revoke ran, then the harness replayed the platform grants the way
-- a real project does, and the privilege was back.
--
-- `relrowsecurity` is not touched by any grant, so the RLS flag survives all
-- of it. Never rely on a table-level revoke alone on this platform.

revoke all on table public.media_jobs from anon, authenticated;
revoke all on table public.product_asset_versions from anon, authenticated;

comment on table public.media_jobs is
  'SUPERSEDED by generation_jobs. Retained, RLS-enabled with no policies and '
  'privileges revoked from tenant roles. Do not build on this table.';

comment on table public.product_asset_versions is
  'SUPERSEDED by asset_versions. Retained, RLS-enabled with no policies and '
  'privileges revoked from tenant roles. Do not build on this table.';

-- ----------------------------------------------------------------------------
-- 2. SECURITY DEFINER functions still executable by PUBLIC
-- ----------------------------------------------------------------------------
-- The high-value definers (reserve_credits, deduct_credits, refund_credits,
-- claim_publishing_jobs, complete_publishing_job, the upsert_* family,
-- purge_expired_oauth_states) were revoked when they were written. These four
-- were missed.
--
-- handle_new_user and set_updated_at are trigger functions, so the practical
-- exposure is low -- a trigger fires as the table owner whatever EXECUTE says,
-- and calling them directly does little. Low is not zero, and a definer
-- function reachable by `anon` is exactly what the hardening rule names, so
-- they are closed for the same reason as the other two rather than argued
-- about. derive_product_workspace and sync_campaign_aliases run under the
-- definer's rights and touch tenant rows; those two matter.

revoke all on function public.derive_product_workspace() from public, anon, authenticated;
revoke all on function public.sync_campaign_aliases() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
