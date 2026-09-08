-- ============================================================================
-- OwBrand — Phase 2: AI infrastructure, Brand Brain versioning, Product Brain
-- ============================================================================
--
-- Adds the tables Phase 2 needs, and columns the AI layer writes:
--
--   brand_brain_versions   append-only Brand Brain history with restore
--   product_facts          the approved-fact set the factuality guard enforces
--   content_factuality     guard findings attached to generated content
--   site_pages/site_sections  persisted website structure (the website builder
--                          previously had nowhere to store what it generated)
--   asset_versions         creative asset version timeline
--
-- Also extends ai_usage_logs with the columns lib/ai/usage.ts writes, and adds
-- the credit-reservation table that makes deduct/refund auditable.
--
-- Idempotent throughout: safe to re-run.
-- ============================================================================

set search_path = public;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Brand Brain versioning
-- ---------------------------------------------------------------------------
-- Append-only. A "restore" inserts a new version whose content is copied from
-- an older one, so history is never rewritten. The unique (brand_id, version)
-- constraint is what makes two concurrent saves safe — the loser retries with a
-- fresh number rather than silently overwriting.
create table if not exists public.brand_brain_versions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  version integer not null check (version > 0),
  brain jsonb not null,
  source text not null default 'ai_generated'
    check (source in ('ai_generated','user_edited','restored','ai_suggestion_applied')),
  created_by uuid references public.users(id) on delete set null,
  restored_from_version integer,
  change_summary text,
  created_at timestamptz not null default now(),
  unique (brand_id, version)
);

create index if not exists brand_brain_versions_brand_version_idx
  on public.brand_brain_versions(brand_id, version desc);

-- ---------------------------------------------------------------------------
-- 2. Product Brain — approved facts
-- ---------------------------------------------------------------------------
-- The factuality guard can only permit what is recorded here. `verified`
-- distinguishes a fact a human confirmed from one the AI proposed: only
-- verified facts are quotable.
create table if not exists public.product_facts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  fact text not null,
  category text not null default 'general'
    check (category in ('general','specification','material','dimension','price','ingredient',
                        'certification','benefit','usage','care','warranty')),
  -- A numeric value the guard may see quoted in copy (price, weight, count).
  numeric_value text,
  unit text,
  verified boolean not null default false,
  verified_by uuid references public.users(id) on delete set null,
  verified_at timestamptz,
  source text not null default 'user_entered'
    check (source in ('user_entered','ai_extracted','imported')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_facts_product_idx on public.product_facts(product_id, verified);

-- ---------------------------------------------------------------------------
-- 3. Factuality findings on generated content
-- ---------------------------------------------------------------------------
-- The guard is a safety net, not a proof, so findings are recorded for human
-- approval rather than used to silently delete copy.
create table if not exists public.content_factuality (
  id uuid primary key default gen_random_uuid(),
  content_asset_id uuid references public.content_assets(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  severity text not null check (severity in ('block','review')),
  category text not null,
  excerpt text not null,
  explanation text not null,
  resolved boolean not null default false,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists content_factuality_asset_idx
  on public.content_factuality(content_asset_id, resolved);
create index if not exists content_factuality_brand_idx
  on public.content_factuality(brand_id, severity, resolved);

-- ---------------------------------------------------------------------------
-- 4. Website builder persistence
-- ---------------------------------------------------------------------------
-- /api/ai/generate-website returned JSON that was never stored, so nothing
-- could render, edit or export it — and the ZIP export shipped an empty
-- package.json because it had no source to stitch together.
create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  slug text not null,
  title text not null default '',
  is_home boolean not null default false,
  seo jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','published')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, slug)
);

create table if not exists public.site_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.site_pages(id) on delete cascade,
  -- hero | features | pricing | testimonials | cta | footer | custom …
  kind text not null,
  sort_order integer not null default 0,
  -- The section's editable content, plus any per-section style overrides.
  content jsonb not null default '{}'::jsonb,
  styles jsonb not null default '{}'::jsonb,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_pages_brand_idx on public.site_pages(brand_id, sort_order);
create index if not exists site_sections_page_idx on public.site_sections(page_id, sort_order);

-- Autosave/undo history for the editor.
create table if not exists public.site_revisions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  version integer not null,
  -- Whole-site snapshot: pages + sections as generated or edited.
  snapshot jsonb not null,
  source text not null default 'user_edited'
    check (source in ('ai_generated','user_edited','restored','autosave')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (brand_id, version)
);

create index if not exists site_revisions_brand_version_idx
  on public.site_revisions(brand_id, version desc);

-- ---------------------------------------------------------------------------
-- 5. Creative asset versions
-- ---------------------------------------------------------------------------
create table if not exists public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  content_asset_id uuid references public.content_assets(id) on delete cascade,
  product_asset_id uuid references public.product_assets(id) on delete cascade,
  version integer not null check (version > 0),
  storage_path text,
  external_url text,
  prompt text,
  provider text,
  provider_job_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Exactly one parent: a version belongs to a content asset or a product
  -- asset, never both and never neither.
  constraint asset_versions_one_parent check (
    (content_asset_id is not null and product_asset_id is null) or
    (content_asset_id is null and product_asset_id is not null)
  )
);

create index if not exists asset_versions_content_idx
  on public.asset_versions(content_asset_id, version desc);
create index if not exists asset_versions_product_idx
  on public.asset_versions(product_asset_id, version desc);

-- ---------------------------------------------------------------------------
-- 6. Extend ai_usage_logs for the Phase 2 writer
-- ---------------------------------------------------------------------------
alter table public.ai_usage_logs add column if not exists task text;
alter table public.ai_usage_logs add column if not exists cached_input_tokens integer not null default 0;

-- ---------------------------------------------------------------------------
-- 7. Credit reservations — make deduct/refund auditable
-- ---------------------------------------------------------------------------
-- canUseFeature() deducts and refundCredits() adds back, but nothing recorded
-- WHY, so a disputed balance could not be reconstructed. Every movement now
-- leaves a row.
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workspace_id uuid,
  -- reserve | refund | grant | reset | adjust
  entry_type text not null check (entry_type in ('reserve','refund','grant','reset','adjust')),
  amount integer not null,
  balance_after integer,
  action text,
  job_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_time_idx on public.credit_ledger(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. updated_at triggers for the new tables
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['product_facts','site_pages','site_sections'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------------
-- Brand-scoped tables reuse can_access_brand() from the Phase 1 migration, so
-- the membership rule lives in exactly one place.

alter table public.brand_brain_versions enable row level security;
alter table public.product_facts        enable row level security;
alter table public.content_factuality   enable row level security;
alter table public.site_pages           enable row level security;
alter table public.site_sections        enable row level security;
alter table public.site_revisions       enable row level security;
alter table public.asset_versions       enable row level security;
alter table public.credit_ledger        enable row level security;

drop policy if exists "brand brain versions tenant" on public.brand_brain_versions;
create policy "brand brain versions tenant" on public.brand_brain_versions
  for all to authenticated
  using (public.can_access_brand(brand_id))
  with check (public.can_access_brand(brand_id));

drop policy if exists "content factuality tenant" on public.content_factuality;
create policy "content factuality tenant" on public.content_factuality
  for all to authenticated
  using (public.can_access_brand(brand_id))
  with check (public.can_access_brand(brand_id));

drop policy if exists "site pages tenant" on public.site_pages;
create policy "site pages tenant" on public.site_pages
  for all to authenticated
  using (public.can_access_brand(brand_id))
  with check (public.can_access_brand(brand_id));

drop policy if exists "site revisions tenant" on public.site_revisions;
create policy "site revisions tenant" on public.site_revisions
  for all to authenticated
  using (public.can_access_brand(brand_id))
  with check (public.can_access_brand(brand_id));

-- Reached through the page, which is brand-scoped.
drop policy if exists "site sections tenant" on public.site_sections;
create policy "site sections tenant" on public.site_sections
  for all to authenticated
  using (exists (select 1 from public.site_pages p
                  where p.id = page_id and public.can_access_brand(p.brand_id)))
  with check (exists (select 1 from public.site_pages p
                  where p.id = page_id and public.can_access_brand(p.brand_id)));

-- Reached through the product, which is brand-scoped.
drop policy if exists "product facts tenant" on public.product_facts;
create policy "product facts tenant" on public.product_facts
  for all to authenticated
  using (exists (select 1 from public.products pr
                  where pr.id = product_id and public.can_access_brand(pr.brand_id)))
  with check (exists (select 1 from public.products pr
                  where pr.id = product_id and public.can_access_brand(pr.brand_id)));

-- Either parent may grant access.
drop policy if exists "asset versions tenant" on public.asset_versions;
create policy "asset versions tenant" on public.asset_versions
  for all to authenticated
  using (
    (content_asset_id is not null and exists (
      select 1 from public.content_assets ca
       where ca.id = content_asset_id
         and (ca.user_id = auth.uid() or public.can_access_brand(ca.brand_id))))
    or
    (product_asset_id is not null and exists (
      select 1 from public.product_assets pa
       join public.products pr on pr.id = pa.product_id
       where pa.id = product_asset_id and public.can_access_brand(pr.brand_id)))
  )
  with check (
    (content_asset_id is not null and exists (
      select 1 from public.content_assets ca
       where ca.id = content_asset_id
         and (ca.user_id = auth.uid() or public.can_access_brand(ca.brand_id))))
    or
    (product_asset_id is not null and exists (
      select 1 from public.product_assets pa
       join public.products pr on pr.id = pa.product_id
       where pa.id = product_asset_id and public.can_access_brand(pr.brand_id)))
  );

-- The ledger is a financial record: readable by its owner, written only by the
-- service role.
drop policy if exists "credit ledger own read" on public.credit_ledger;
create policy "credit ledger own read" on public.credit_ledger
  for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin());

-- ---------------------------------------------------------------------------
-- 10. Atomic credit reservation with a ledger entry
-- ---------------------------------------------------------------------------
-- Wraps deduct + ledger write in one statement so a balance can never move
-- without a corresponding record.
create or replace function public.reserve_credits(
  p_user_id uuid,
  p_amount integer,
  p_action text default null,
  p_job_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid_amount';
  end if;

  if p_amount = 0 then
    select credits_remaining into new_balance from public.subscriptions where user_id = p_user_id;
    return new_balance;
  end if;

  update public.subscriptions
     set credits_remaining = credits_remaining - p_amount
   where user_id = p_user_id
     and credits_remaining >= p_amount
  returning credits_remaining into new_balance;

  if new_balance is null then
    raise exception 'insufficient_credits';
  end if;

  insert into public.credit_ledger(user_id, entry_type, amount, balance_after, action, job_id)
  values (p_user_id, 'reserve', -p_amount, new_balance, p_action, p_job_id);

  return new_balance;
end;
$$;

create or replace function public.refund_credits_logged(
  p_user_id uuid,
  p_amount integer,
  p_reason text default null,
  p_job_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    select credits_remaining into new_balance from public.subscriptions where user_id = p_user_id;
    return new_balance;
  end if;

  -- Reuses the Phase 1 capped refund so a refund still cannot exceed the plan
  -- ceiling.
  select public.refund_credits(p_user_id, p_amount) into new_balance;

  insert into public.credit_ledger(user_id, entry_type, amount, balance_after, reason, job_id)
  values (p_user_id, 'refund', p_amount, new_balance, p_reason, p_job_id);

  return new_balance;
end;
$$;

revoke all on function public.reserve_credits(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.refund_credits_logged(uuid, integer, text, uuid) from public, anon, authenticated;
