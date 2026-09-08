/**
 * Authorization guards — the single place tenant isolation is decided.
 *
 * WHY THIS EXISTS
 * OwBrand's routes use the service-role Supabase client, which bypasses RLS.
 * That is a legitimate pattern only if every read and write proves ownership in
 * application code first. Before Phase 1 several routes did not, so a logged-in
 * user could read another tenant's brands, products and campaigns by guessing
 * an id. Every such lookup now goes through a guard in this file.
 *
 * RULES
 *  1. Never trust userId, workspaceId, brandId, role, plan or credits from a
 *     client. Identity comes from the Supabase session; everything else is
 *     re-derived from the database.
 *  2. A guard returns the row it verified, so the caller does not re-query and
 *     cannot accidentally skip the check.
 *  3. A missing row and an inaccessible row both raise 404. Returning 403 for a
 *     row that exists but belongs to someone else would confirm its existence
 *     to an attacker enumerating ids.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api/errors';

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
}

/** Resolves the session user or raises 401. */
export async function requireUser(): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) throw ApiError.unauthenticated();
  return user;
}

/** Resolves the session user and requires the app-level admin role, or raises. */
export async function requireAdminUser(): Promise<AuthedUser> {
  const user = await requireUser();
  if (user.role !== 'admin') {
    throw ApiError.forbidden('Admin access required.', { userId: user.id });
  }
  return user;
}

type Db = SupabaseClient<any, any, any>;

/* ------------------------------------------------------------------ *
 * Workspace membership
 * ------------------------------------------------------------------ */

async function isWorkspaceMember(db: Db, userId: string, workspaceId: string | null): Promise<boolean> {
  if (!workspaceId) return false;

  const { data: workspace } = await db
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (workspace) return true;

  const { data: membership } = await db
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(membership);
}

/**
 * Verifies the user owns, or is a member of, the workspace. Returns its id.
 */
export async function assertWorkspaceAccess(userId: string, workspaceId: string, db: Db = supabaseAdmin()) {
  const allowed = await isWorkspaceMember(db, userId, workspaceId);
  if (!allowed) {
    throw ApiError.notFound('Workspace not found.');
  }
  return { id: workspaceId };
}

/* ------------------------------------------------------------------ *
 * Brand access — the root of almost every OwBrand resource
 * ------------------------------------------------------------------ */

export interface BrandRecord {
  id: string;
  user_id: string;
  workspace_id: string | null;
  name: string;
  [key: string]: unknown;
}

/**
 * Verifies the user may act on the brand, either as its direct owner or through
 * workspace membership. Returns the brand row so callers reuse it.
 *
 * `columns` lets a caller widen the projection without a second round-trip;
 * id/user_id/workspace_id are always included because the check needs them.
 */
export async function assertBrandAccess(
  userId: string,
  brandId: string,
  options: { db?: Db; columns?: string } = {}
): Promise<BrandRecord> {
  const db = options.db ?? supabaseAdmin();
  const projection = options.columns
    ? Array.from(new Set(['id', 'user_id', 'workspace_id', ...options.columns.split(',').map((c) => c.trim())])).join(',')
    : 'id,user_id,workspace_id,name';

  const { data: brand, error } = await db.from('brands').select(projection).eq('id', brandId).maybeSingle();

  if (error) throw new ApiError('internal', undefined, { internal: error });
  if (!brand) throw ApiError.notFound('Brand not found.');

  const record = brand as unknown as BrandRecord;
  if (record.user_id === userId) return record;

  if (await isWorkspaceMember(db, userId, record.workspace_id)) return record;

  // Deliberately 404, not 403 — see the file header.
  throw ApiError.notFound('Brand not found.');
}

/**
 * Every brand id the user may read. Used by dashboard aggregates so a query can
 * be scoped with `.in('brand_id', ids)` instead of running unscoped.
 * Returns [] when the user has no brands — callers must treat that as "show
 * nothing", never as "no filter".
 */
export async function accessibleBrandIds(userId: string, db: Db = supabaseAdmin()): Promise<string[]> {
  const { data: owned } = await db.from('brands').select('id').eq('user_id', userId);
  const ids = new Set((owned ?? []).map((b: { id: string }) => b.id));

  const { data: memberships } = await db.from('workspace_members').select('workspace_id').eq('user_id', userId);
  const { data: ownedWorkspaces } = await db.from('workspaces').select('id').eq('owner_id', userId);

  const workspaceIds = [
    ...(memberships ?? []).map((m: { workspace_id: string }) => m.workspace_id),
    ...(ownedWorkspaces ?? []).map((w: { id: string }) => w.id),
  ].filter(Boolean);

  if (workspaceIds.length > 0) {
    const { data: shared } = await db.from('brands').select('id').in('workspace_id', workspaceIds);
    for (const brand of shared ?? []) ids.add((brand as { id: string }).id);
  }

  return Array.from(ids);
}

/* ------------------------------------------------------------------ *
 * Resources hanging off a brand
 * ------------------------------------------------------------------ */

/** Verifies product → brand → user. Returns { product, brand }. */
export async function assertProductAccess(
  userId: string,
  productId: string,
  options: { db?: Db; brandId?: string } = {}
) {
  const db = options.db ?? supabaseAdmin();

  const { data: product, error } = await db
    .from('products')
    .select('id,brand_id,name,description,category,price')
    .eq('id', productId)
    .maybeSingle();

  if (error) throw new ApiError('internal', undefined, { internal: error });
  if (!product) throw ApiError.notFound('Product not found.');

  // If the caller also passed a brandId, the two must agree — this stops a
  // caller pairing their own brandId with someone else's productId.
  if (options.brandId && product.brand_id !== options.brandId) {
    throw ApiError.notFound('Product not found.');
  }

  const brand = await assertBrandAccess(userId, product.brand_id as string, { db });
  return { product, brand };
}

/** Verifies product_asset → product → brand → user. */
export async function assertProductAssetAccess(
  userId: string,
  assetId: string,
  options: { db?: Db; productId?: string } = {}
) {
  const db = options.db ?? supabaseAdmin();

  const { data: asset, error } = await db
    .from('product_assets')
    .select('id,product_id,url,type,metadata,status')
    .eq('id', assetId)
    .maybeSingle();

  if (error) throw new ApiError('internal', undefined, { internal: error });
  if (!asset) throw ApiError.notFound('Asset not found.');
  if (options.productId && asset.product_id !== options.productId) {
    throw ApiError.notFound('Asset not found.');
  }

  const { product, brand } = await assertProductAccess(userId, asset.product_id as string, { db });
  return { asset, product, brand };
}

/** Verifies content_asset ownership (these are user-scoped, plus a brand check). */
export async function assertContentAssetAccess(userId: string, assetId: string, db: Db = supabaseAdmin()) {
  const { data: asset, error } = await db
    .from('content_assets')
    // `metadata` is included because callers that have proved access to the
    // asset legitimately need its carousel media list (see
    // /api/scheduler/schedule-post). It holds no credentials.
    .select('id,user_id,brand_id,type,url,caption,status,metadata')
    .eq('id', assetId)
    .maybeSingle();

  if (error) throw new ApiError('internal', undefined, { internal: error });
  if (!asset) throw ApiError.notFound('Asset not found.');

  if (asset.user_id !== userId) {
    // Could still be reachable through a shared workspace brand.
    await assertBrandAccess(userId, asset.brand_id as string, { db });
  }
  return asset;
}

/** Verifies campaign → brand → user. */
export async function assertCampaignAccess(userId: string, campaignId: string, db: Db = supabaseAdmin()) {
  const { data: campaign, error } = await db
    .from('campaigns')
    .select('id,brand_id,name,objective,status')
    .eq('id', campaignId)
    .maybeSingle();

  if (error) throw new ApiError('internal', undefined, { internal: error });
  if (!campaign) throw ApiError.notFound('Campaign not found.');

  const brand = await assertBrandAccess(userId, campaign.brand_id as string, { db });
  return { campaign, brand };
}

/**
 * Verifies a storage path belongs to the caller before it is ever signed.
 * Paths are `<userId>/<brandId>/<productId>/<file>` by convention, so the first
 * segment must be the authenticated user's id. Also rejects traversal.
 */
export function assertStoragePathOwnership(userId: string, path: string): string {
  const normalized = path.replace(/^\/+/, '');

  if (normalized.includes('..') || normalized.includes('\\') || normalized.includes('\0')) {
    throw ApiError.forbidden('Invalid storage path.');
  }

  const [owner, ...rest] = normalized.split('/');
  if (owner !== userId || rest.length === 0) {
    throw ApiError.notFound('File not found.');
  }
  return normalized;
}
