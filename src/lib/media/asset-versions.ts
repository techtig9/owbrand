/**
 * Creative asset version history.
 *
 * The master command asks for asset versioning, compare-versions and remix.
 * Previously each generation inserted a brand-new `product_assets` row, so
 * there was no lineage: you could not tell which shot was a regeneration of
 * which, and "compare versions" had nothing to compare.
 *
 * Versions are numbered per parent asset and append-only, matching the Brand
 * Brain model — a regeneration adds a version, it never replaces one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

type Db = SupabaseClient<any, any, any>;

export interface AssetVersion {
  id: string;
  version: number;
  storagePath: string | null;
  externalUrl: string | null;
  prompt: string | null;
  provider: string | null;
  providerJobId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export interface RecordVersionInput {
  /** Exactly one parent. The table enforces this with a CHECK constraint. */
  contentAssetId?: string;
  productAssetId?: string;
  storagePath?: string | null;
  externalUrl?: string | null;
  prompt?: string | null;
  provider?: string | null;
  providerJobId?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

/**
 * Appends a version.
 *
 * The number comes from a read of the current maximum plus a unique constraint
 * as the backstop; a collision retries once. Same pattern as the Brand Brain
 * store, for the same reason: two concurrent regenerations must not both become
 * version 3.
 */
export async function recordAssetVersion(
  input: RecordVersionInput,
  db: Db = supabaseAdmin()
): Promise<AssetVersion> {
  if (!input.contentAssetId === !input.productAssetId) {
    throw new Error('recordAssetVersion requires exactly one of contentAssetId or productAssetId.');
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const version = await nextVersion(input, db);

    const { data, error } = await db
      .from('asset_versions')
      .insert({
        content_asset_id: input.contentAssetId ?? null,
        product_asset_id: input.productAssetId ?? null,
        version,
        storage_path: input.storagePath ?? null,
        external_url: input.externalUrl ?? null,
        prompt: input.prompt ?? null,
        provider: input.provider ?? null,
        provider_job_id: input.providerJobId ?? null,
        metadata: input.metadata ?? {},
        created_by: input.createdBy ?? null,
      })
      .select('*')
      .single();

    if (!error && data) return toVersion(data);

    // 23505 = unique_violation: a concurrent write took this number.
    if (error && (error as { code?: string }).code === '23505') continue;

    throw error ?? new Error('Could not record the asset version.');
  }

  throw new Error('Could not record the asset version after a version collision.');
}

async function nextVersion(input: RecordVersionInput, db: Db): Promise<number> {
  const column = input.contentAssetId ? 'content_asset_id' : 'product_asset_id';
  const value = input.contentAssetId ?? input.productAssetId;

  const { data } = await db
    .from('asset_versions')
    .select('version')
    .eq(column, value)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  return ((data as { version?: number } | null)?.version ?? 0) + 1;
}

function toVersion(row: Record<string, any>): AssetVersion {
  return {
    id: row.id,
    version: row.version,
    storagePath: row.storage_path ?? null,
    externalUrl: row.external_url ?? null,
    prompt: row.prompt ?? null,
    provider: row.provider ?? null,
    providerJobId: row.provider_job_id ?? null,
    metadata: row.metadata ?? {},
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

/** Version timeline for one asset, newest first. */
export async function listAssetVersions(
  parent: { contentAssetId?: string; productAssetId?: string },
  db: Db = supabaseAdmin()
): Promise<AssetVersion[]> {
  const column = parent.contentAssetId ? 'content_asset_id' : 'product_asset_id';
  const value = parent.contentAssetId ?? parent.productAssetId;
  if (!value) return [];

  const { data, error } = await db
    .from('asset_versions')
    .select('*')
    .eq(column, value)
    .order('version', { ascending: false })
    .limit(50);

  if (error) {
    logger.warn('asset_versions:list_failed', { error: String(error.message) });
    return [];
  }

  return (data ?? []).map(toVersion);
}
