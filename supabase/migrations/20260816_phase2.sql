-- OwBrand Phase 2: creative production foundation
create table if not exists product_asset_versions (
  id uuid primary key default uuid_generate_v4(),
  product_asset_id uuid not null references product_assets(id) on delete cascade,
  version integer not null,
  kind text not null default 'original',
  storage_path text,
  provider text,
  prompt text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(product_asset_id, version)
);

alter table product_assets add column if not exists status text not null default 'uploaded';
alter table product_assets add column if not exists source text not null default 'user_upload';
alter table product_assets add column if not exists analysis jsonb not null default '{}'::jsonb;

create table if not exists media_jobs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  source_asset_id uuid references product_assets(id) on delete set null,
  kind text not null,
  provider text,
  status ai_job_status not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists media_jobs_status_idx on media_jobs(status, created_at);
create index if not exists product_assets_product_idx on product_assets(product_id, created_at);

-- Private bucket. Original product images and generated media are accessed through signed URLs.
insert into storage.buckets (id, name, public)
values ('owbrand-media', 'owbrand-media', false)
on conflict (id) do nothing;

-- Folder convention: <auth-user-id>/<brand-id>/<product-id>/<filename>
drop policy if exists "owbrand media upload" on storage.objects;
drop policy if exists "owbrand media read" on storage.objects;
drop policy if exists "owbrand media delete" on storage.objects;
create policy "owbrand media upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'owbrand-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owbrand media read" on storage.objects
for select to authenticated
using (bucket_id = 'owbrand-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owbrand media delete" on storage.objects
for delete to authenticated
using (bucket_id = 'owbrand-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Helpful indexes for phase 2 workloads.
create index if not exists content_assets_product_idx on content_assets(product_id, created_at);
create index if not exists approvals_asset_idx on approvals(asset_id, status);
