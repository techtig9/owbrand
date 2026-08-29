-- OwBrand production foundation schema.
-- Run this on a fresh Supabase project. For an existing installation, migrate
-- the existing tables into this shape before enabling the new modules.
create extension if not exists "uuid-ossp";

create type user_role as enum ('user','admin');
create type plan_id as enum ('free','starter','pro','business');
create type subscription_status as enum ('active','past_due','cancelled','trialing');
create type content_asset_type as enum ('photo','post','logo','content','reel','video','ad');
create type content_asset_status as enum ('draft','approved','published','failed');
create type social_platform as enum ('facebook','instagram','tiktok','youtube','linkedin','pinterest','x');
create type scheduled_post_status as enum ('queued','published','failed','cancelled');
create type deployment_provider as enum ('vercel','netlify');
create type deployment_status as enum ('pending','building','live','failed');
create type approval_status as enum ('pending','approved','rejected');
create type campaign_status as enum ('draft','planning','active','paused','completed');
create type ai_job_status as enum ('queued','running','completed','failed','cancelled');

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '', email text not null, role user_role not null default 'user',
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default uuid_generate_v4(), owner_id uuid not null references users(id) on delete cascade,
  name text not null default 'My Workspace', created_at timestamptz not null default now()
);
create table workspace_members (
  id uuid primary key default uuid_generate_v4(), workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade, role text not null default 'member',
  created_at timestamptz not null default now(), unique(workspace_id,user_id)
);

create table brands (
  id uuid primary key default uuid_generate_v4(), workspace_id uuid references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade, name text not null,
  logo_url text, brand_colors text[] not null default '{}', brand_fonts text[] not null default '{}',
  description text not null default '', created_at timestamptz not null default now()
);
create index brands_workspace_idx on brands(workspace_id);

create table brand_profiles (
  brand_id uuid primary key references brands(id) on delete cascade,
  industry text default '', business_type text default '', location text default '', target_markets text[] not null default '{}',
  goals text[] not null default '{}', target_audience jsonb not null default '{}'::jsonb,
  positioning jsonb not null default '{}'::jsonb, personality text[] not null default '{}',
  tone text[] not null default '{}', voice text default '', story text default '', usp text default '',
  competitors jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now()
);
create table brand_guidelines (
  brand_id uuid primary key references brands(id) on delete cascade,
  colors jsonb not null default '{}'::jsonb, typography jsonb not null default '{}'::jsonb,
  photography jsonb not null default '{}'::jsonb, logo_rules jsonb not null default '{}'::jsonb,
  do_rules text[] not null default '{}', dont_rules text[] not null default '{}',
  preferred_words text[] not null default '{}', avoided_words text[] not null default '{}', updated_at timestamptz not null default now()
);
create table brand_rules (
  id uuid primary key default uuid_generate_v4(), brand_id uuid not null references brands(id) on delete cascade,
  rule text not null, type text not null default 'preference', created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default uuid_generate_v4(), brand_id uuid not null references brands(id) on delete cascade,
  name text not null, slug text, description text not null default '', category text default '',
  price numeric(12,2), currency text default 'USD', sku text, stock integer default 0,
  features text[] not null default '{}', benefits text[] not null default '{}', specifications jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb, status text not null default 'active', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index products_brand_idx on products(brand_id);
create table product_variants (
  id uuid primary key default uuid_generate_v4(), product_id uuid not null references products(id) on delete cascade,
  name text not null, options jsonb not null default '{}'::jsonb, sku text, price numeric(12,2), stock integer default 0
);
create table product_assets (
  id uuid primary key default uuid_generate_v4(), product_id uuid not null references products(id) on delete cascade,
  type text not null, url text not null, prompt text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table templates (id uuid primary key default uuid_generate_v4(), category text not null, name text not null, thumbnail text);
create table content_assets (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references users(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade, product_id uuid references products(id) on delete set null,
  type content_asset_type not null, url text, caption text, status content_asset_status not null default 'draft',
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table scheduled_posts (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references users(id) on delete cascade,
  content_asset_id uuid not null references content_assets(id) on delete cascade, platform social_platform not null,
  scheduled_at timestamptz not null, status scheduled_post_status not null default 'queued', external_id text
);
create table social_accounts (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references users(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade, platform social_platform not null,
  account_name text, external_account_id text, access_token text not null, refresh_token text,
  connected_at timestamptz not null default now(), expires_at timestamptz, metadata jsonb not null default '{}'::jsonb,
  unique(user_id,platform,brand_id)
);

create table content_calendar (
  id uuid primary key default uuid_generate_v4(), brand_id uuid not null references brands(id) on delete cascade,
  content_asset_id uuid references content_assets(id) on delete set null, platform social_platform,
  planned_at timestamptz, theme text, status text not null default 'planned', metadata jsonb not null default '{}'::jsonb
);
create table approvals (
  id uuid primary key default uuid_generate_v4(), brand_id uuid not null references brands(id) on delete cascade,
  asset_id uuid references content_assets(id) on delete cascade, campaign_id uuid, status approval_status not null default 'pending',
  reviewer_id uuid references users(id), notes text, created_at timestamptz not null default now()
);
create table campaigns (
  id uuid primary key default uuid_generate_v4(), brand_id uuid not null references brands(id) on delete cascade,
  name text not null, objective text not null default 'awareness', status campaign_status not null default 'draft',
  budget numeric(12,2), start_at timestamptz, end_at timestamptz, strategy jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table campaign_assets (
  id uuid primary key default uuid_generate_v4(), campaign_id uuid not null references campaigns(id) on delete cascade,
  content_asset_id uuid references content_assets(id) on delete set null, channel text, variant text, metadata jsonb not null default '{}'::jsonb
);
create table ad_accounts (
  id uuid primary key default uuid_generate_v4(), brand_id uuid not null references brands(id) on delete cascade,
  platform text not null, external_account_id text, status text not null default 'connected', metadata jsonb not null default '{}'::jsonb
);

create table analytics_snapshots (
  id uuid primary key default uuid_generate_v4(), brand_id uuid not null references brands(id) on delete cascade,
  platform text not null, period_start date not null, period_end date not null, metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table ai_recommendations (
  id uuid primary key default uuid_generate_v4(), brand_id uuid not null references brands(id) on delete cascade,
  title text not null, recommendation text not null, priority text not null default 'medium',
  action_type text, status text not null default 'open', metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table ai_jobs (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references users(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade, kind text not null, status ai_job_status not null default 'queued',
  input jsonb not null default '{}'::jsonb, output jsonb not null default '{}'::jsonb, error text,
  credits_reserved integer not null default 0, created_at timestamptz not null default now(), completed_at timestamptz
);

create table subscriptions (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null unique references users(id) on delete cascade,
  plan plan_id not null default 'free', status subscription_status not null default 'active', provider text not null default 'paddle',
  paddle_subscription_id text, paddle_customer_id text, credits_remaining integer not null default 500, renews_at timestamptz
);
create table payments (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null references users(id) on delete cascade,
  paddle_transaction_id text not null unique, amount numeric(10,2) not null, status text not null, created_at timestamptz not null default now()
);
create table deployments (
  id uuid primary key default uuid_generate_v4(), project_id uuid not null references brands(id) on delete cascade,
  provider deployment_provider not null, deployment_url text, status deployment_status not null default 'pending'
);

create function handle_new_user() returns trigger as $$
begin
  insert into public.users(id,name,email,role) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)),new.email,'user');
  insert into public.workspaces(owner_id,name) values(new.id,'My Workspace');
  insert into public.subscriptions(user_id,plan,status,credits_remaining) values(new.id,'free','active',500);
  return new;
end; $$ language plpgsql security definer;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure handle_new_user();

create function deduct_credits(p_user_id uuid,p_amount integer) returns integer as $$
declare new_balance integer; begin
 update subscriptions set credits_remaining=credits_remaining-p_amount where user_id=p_user_id and credits_remaining>=p_amount returning credits_remaining into new_balance;
 if new_balance is null then raise exception 'insufficient_credits'; end if; return new_balance; end; $$ language plpgsql security definer;
create function refund_credits(p_user_id uuid,p_amount integer) returns void as $$ begin update subscriptions set credits_remaining=credits_remaining+p_amount where user_id=p_user_id; end; $$ language plpgsql security definer;

alter table users enable row level security;
alter table workspaces enable row level security; alter table workspace_members enable row level security;
alter table brands enable row level security; alter table brand_profiles enable row level security; alter table brand_guidelines enable row level security; alter table brand_rules enable row level security;
alter table products enable row level security; alter table product_variants enable row level security; alter table product_assets enable row level security;
alter table content_assets enable row level security; alter table scheduled_posts enable row level security; alter table social_accounts enable row level security;
alter table content_calendar enable row level security; alter table approvals enable row level security; alter table campaigns enable row level security; alter table campaign_assets enable row level security;
alter table ad_accounts enable row level security; alter table analytics_snapshots enable row level security; alter table ai_recommendations enable row level security; alter table ai_jobs enable row level security;
alter table subscriptions enable row level security; alter table payments enable row level security; alter table deployments enable row level security; alter table templates enable row level security;

create policy "users own" on users for all using(auth.uid()=id);
create policy "workspace owner/member" on workspaces for all using(auth.uid()=owner_id or exists(select 1 from workspace_members wm where wm.workspace_id=id and wm.user_id=auth.uid()));
create policy "workspace members own" on workspace_members for all using(auth.uid()=user_id or exists(select 1 from workspaces w where w.id=workspace_id and w.owner_id=auth.uid()));
create policy "brand owner" on brands for all using(auth.uid()=user_id or exists(select 1 from workspace_members wm where wm.workspace_id=brands.workspace_id and wm.user_id=auth.uid()));
create policy "brand profiles owner" on brand_profiles for all using(exists(select 1 from brands b where b.id=brand_profiles.brand_id and (b.user_id=auth.uid() or exists(select 1 from workspace_members wm where wm.workspace_id=b.workspace_id and wm.user_id=auth.uid()))));
create policy "brand guidelines owner" on brand_guidelines for all using(exists(select 1 from brands b where b.id=brand_guidelines.brand_id and (b.user_id=auth.uid() or exists(select 1 from workspace_members wm where wm.workspace_id=b.workspace_id and wm.user_id=auth.uid()))));
create policy "brand rules owner" on brand_rules for all using(exists(select 1 from brands b where b.id=brand_rules.brand_id and (b.user_id=auth.uid() or exists(select 1 from workspace_members wm where wm.workspace_id=b.workspace_id and wm.user_id=auth.uid()))));
create policy "products owner" on products for all using(exists(select 1 from brands b where b.id=products.brand_id and (b.user_id=auth.uid() or exists(select 1 from workspace_members wm where wm.workspace_id=b.workspace_id and wm.user_id=auth.uid()))));
create policy "variants owner" on product_variants for all using(exists(select 1 from products p join brands b on b.id=p.brand_id where p.id=product_variants.product_id and (b.user_id=auth.uid() or exists(select 1 from workspace_members wm where wm.workspace_id=b.workspace_id and wm.user_id=auth.uid()))));
create policy "product assets owner" on product_assets for all using(exists(select 1 from products p join brands b on b.id=p.brand_id where p.id=product_assets.product_id and (b.user_id=auth.uid() or exists(select 1 from workspace_members wm where wm.workspace_id=b.workspace_id and wm.user_id=auth.uid()))));
create policy "content owner" on content_assets for all using(auth.uid()=user_id);
create policy "scheduled owner" on scheduled_posts for all using(auth.uid()=user_id);
create policy "social owner" on social_accounts for all using(auth.uid()=user_id);
create policy "calendar owner" on content_calendar for all using(exists(select 1 from brands b where b.id=content_calendar.brand_id and b.user_id=auth.uid()));
create policy "approval owner" on approvals for all using(exists(select 1 from brands b where b.id=approvals.brand_id and b.user_id=auth.uid()));
create policy "campaign owner" on campaigns for all using(exists(select 1 from brands b where b.id=campaigns.brand_id and b.user_id=auth.uid()));
create policy "campaign assets owner" on campaign_assets for all using(exists(select 1 from campaigns c join brands b on b.id=c.brand_id where c.id=campaign_assets.campaign_id and b.user_id=auth.uid()));
create policy "ad account owner" on ad_accounts for all using(exists(select 1 from brands b where b.id=ad_accounts.brand_id and b.user_id=auth.uid()));
create policy "analytics owner" on analytics_snapshots for all using(exists(select 1 from brands b where b.id=analytics_snapshots.brand_id and b.user_id=auth.uid()));
create policy "recommendation owner" on ai_recommendations for all using(exists(select 1 from brands b where b.id=ai_recommendations.brand_id and b.user_id=auth.uid()));
create policy "jobs owner" on ai_jobs for all using(auth.uid()=user_id);
create policy "subscription read" on subscriptions for select using(auth.uid()=user_id);
create policy "payments read" on payments for select using(auth.uid()=user_id);
create policy "deployment owner" on deployments for select using(exists(select 1 from brands b where b.id=deployments.project_id and b.user_id=auth.uid()));
create policy "templates read" on templates for select using(true);

insert into templates(category,name,thumbnail) values
('Business','Modern Business',null),('Restaurant','Bistro Fresh',null),('Beauty','Glow Studio',null),('E-commerce','Shopfront',null),('SaaS','Cloudframe',null),('Agency','Collective',null),('Fashion','Atelier',null),('Food','Fresh Table',null),('Travel','Wanderlist',null),('Education','Learnly',null)
on conflict do nothing;
