/**
 * Brand Brain persistence, versioning and restore.
 *
 * The master command asks for editable AI decisions, version history and
 * "restore previous version". Before Phase 2 a Brand Brain was scattered
 * write-once across five tables (`brands`, `brand_profiles`,
 * `brand_guidelines`, `brand_rules`, `ai_recommendations`) with no version
 * concept at all — regenerating overwrote the previous brand irrecoverably.
 *
 * The model here is append-only: every save writes a new numbered version and
 * points the brand at it. Restoring is therefore not a rollback but a new
 * version whose content is copied from an old one, so the history of what
 * happened is never rewritten.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { brandBrainSchema, type BrandBrain } from '@/lib/brand/schema';

type Db = SupabaseClient<any, any, any>;

export type BrandBrainSource = 'ai_generated' | 'user_edited' | 'restored' | 'ai_suggestion_applied';

export interface BrandBrainVersion {
  id: string;
  brandId: string;
  version: number;
  brain: BrandBrain;
  source: BrandBrainSource;
  createdBy: string | null;
  createdAt: string;
  /** Set when this version was produced by restoring an earlier one. */
  restoredFromVersion: number | null;
  changeSummary: string | null;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * The brand's current Brand Brain, or null when none has been generated.
 *
 * Validation happens on read as well as write: a row stored before a schema
 * change should degrade to defaults rather than crash a generation. A row that
 * cannot be coerced at all is reported and treated as absent.
 */
export async function getCurrentBrandBrain(brandId: string, db: Db = supabaseAdmin()): Promise<BrandBrain | null> {
  const { data, error } = await db
    .from('brand_brain_versions')
    .select('brain, version')
    .eq('brand_id', brandId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn('brand_brain:read_failed', { brandId, error: String(error.message) });
    return null;
  }
  if (!data) return null;

  const parsed = brandBrainSchema.safeParse((data as { brain: unknown }).brain);
  if (!parsed.success) {
    logger.warn('brand_brain:stored_version_invalid', {
      brandId,
      version: (data as { version: number }).version,
      issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
    });
    return null;
  }

  return parsed.data;
}

/** Version history, newest first. Content included so the UI can diff. */
export async function listBrandBrainVersions(
  brandId: string,
  options: { limit?: number; db?: Db } = {}
): Promise<BrandBrainVersion[]> {
  const db = options.db ?? supabaseAdmin();

  const { data, error } = await db
    .from('brand_brain_versions')
    .select('id, brand_id, version, brain, source, created_by, created_at, restored_from_version, change_summary')
    .eq('brand_id', brandId)
    .order('version', { ascending: false })
    .limit(options.limit ?? 50);

  if (error) throw error;

  return (data ?? []).map(toVersion).filter((v): v is BrandBrainVersion => v !== null);
}

export async function getBrandBrainVersion(
  brandId: string,
  version: number,
  db: Db = supabaseAdmin()
): Promise<BrandBrainVersion | null> {
  const { data, error } = await db
    .from('brand_brain_versions')
    .select('id, brand_id, version, brain, source, created_by, created_at, restored_from_version, change_summary')
    .eq('brand_id', brandId)
    .eq('version', version)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return toVersion(data);
}

function toVersion(row: Record<string, any>): BrandBrainVersion | null {
  const parsed = brandBrainSchema.safeParse(row.brain);
  if (!parsed.success) return null;

  return {
    id: row.id,
    brandId: row.brand_id,
    version: row.version,
    brain: parsed.data,
    source: (row.source as BrandBrainSource) ?? 'ai_generated',
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    restoredFromVersion: row.restored_from_version ?? null,
    changeSummary: row.change_summary ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export interface SaveBrandBrainInput {
  brandId: string;
  brain: unknown;
  source: BrandBrainSource;
  createdBy?: string | null;
  restoredFromVersion?: number | null;
  changeSummary?: string | null;
}

/**
 * Validates and stores a new version.
 *
 * The version number comes from a database-side sequence rather than a
 * read-then-increment: two concurrent saves must not both become version 4.
 * The unique (brand_id, version) constraint is the backstop, and a collision
 * is retried once against a freshly-read number.
 */
export async function saveBrandBrain(
  input: SaveBrandBrainInput,
  db: Db = supabaseAdmin()
): Promise<BrandBrainVersion> {
  const parsed = brandBrainSchema.safeParse(input.brain);
  if (!parsed.success) {
    logger.warn('brand_brain:save_rejected_invalid', {
      brandId: input.brandId,
      issues: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    throw ApiError.invalid('That Brand Brain is missing required details and was not saved.', {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const brain = parsed.data;

  for (let attempt = 0; attempt < 2; attempt++) {
    const nextVersion = await nextVersionNumber(input.brandId, db);

    const { data, error } = await db
      .from('brand_brain_versions')
      .insert({
        brand_id: input.brandId,
        version: nextVersion,
        brain,
        source: input.source,
        created_by: input.createdBy ?? null,
        restored_from_version: input.restoredFromVersion ?? null,
        change_summary: input.changeSummary ?? null,
      })
      .select('id, brand_id, version, brain, source, created_by, created_at, restored_from_version, change_summary')
      .single();

    if (!error && data) {
      // Keep the denormalised columns on `brands` in step so existing screens
      // and the website builder keep working without a rewrite.
      await syncBrandSummary(input.brandId, brain, db);

      logger.info('brand_brain:saved', {
        brandId: input.brandId,
        version: nextVersion,
        source: input.source,
      });

      const version = toVersion(data);
      if (version) return version;
      throw new ApiError('internal', undefined, { internal: 'saved version failed to re-validate' });
    }

    // 23505 = unique_violation: a concurrent save took this number. Retry once.
    if (error && (error as { code?: string }).code === '23505') {
      logger.info('brand_brain:version_collision_retrying', { brandId: input.brandId, version: nextVersion });
      continue;
    }

    throw error ?? new Error('Could not save the Brand Brain.');
  }

  throw new ApiError('conflict', 'Someone else saved a change at the same time. Please try again.');
}

async function nextVersionNumber(brandId: string, db: Db): Promise<number> {
  const { data } = await db
    .from('brand_brain_versions')
    .select('version')
    .eq('brand_id', brandId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  return ((data as { version?: number } | null)?.version ?? 0) + 1;
}

/**
 * Mirrors a few Brand Brain fields onto `brands` so screens that read the brand
 * row directly stay correct. The versions table remains authoritative.
 */
async function syncBrandSummary(brandId: string, brain: BrandBrain, db: Db): Promise<void> {
  const colors = (brain.visualIdentity?.colors ?? []).map((c) => c.hex).filter(Boolean);
  const fonts = [brain.visualIdentity?.fonts?.heading, brain.visualIdentity?.fonts?.body].filter(
    (f): f is string => Boolean(f)
  );

  const { error } = await db
    .from('brands')
    .update({
      name: brain.name,
      ...(colors.length > 0 ? { brand_colors: colors } : {}),
      ...(fonts.length > 0 ? { brand_fonts: fonts } : {}),
    })
    .eq('id', brandId);

  if (error) {
    logger.warn('brand_brain:brand_summary_sync_failed', { brandId, error: String(error.message) });
  }
}

/**
 * Restores an earlier version by creating a NEW version with its content.
 *
 * Deliberately not a destructive rollback: the history of what the brand looked
 * like, and when, stays intact and auditable.
 */
export async function restoreBrandBrainVersion(
  options: { brandId: string; version: number; userId: string; db?: Db }
): Promise<BrandBrainVersion> {
  const db = options.db ?? supabaseAdmin();

  const source = await getBrandBrainVersion(options.brandId, options.version, db);
  if (!source) throw ApiError.notFound('That Brand Brain version no longer exists.');

  return saveBrandBrain(
    {
      brandId: options.brandId,
      brain: source.brain,
      source: 'restored',
      createdBy: options.userId,
      restoredFromVersion: options.version,
      changeSummary: `Restored from version ${options.version}`,
    },
    db
  );
}

/**
 * Applies a partial edit to the current version, producing a new one.
 * Used by the inline editors on the Brand Brain screen.
 */
export async function updateBrandBrain(options: {
  brandId: string;
  userId: string;
  patch: Record<string, unknown>;
  changeSummary?: string;
  db?: Db;
}): Promise<BrandBrainVersion> {
  const db = options.db ?? supabaseAdmin();

  const current = await getCurrentBrandBrain(options.brandId, db);
  if (!current) {
    throw ApiError.notFound('This brand does not have a Brand Brain yet. Generate one first.');
  }

  // Section-level merge: a patch replaces whole sections rather than being
  // deep-merged, so an edit that removes a list item actually removes it.
  const merged = { ...current, ...options.patch };

  return saveBrandBrain(
    {
      brandId: options.brandId,
      brain: merged,
      source: 'user_edited',
      createdBy: options.userId,
      changeSummary: options.changeSummary ?? describePatch(options.patch),
    },
    db
  );
}

function describePatch(patch: Record<string, unknown>): string {
  const keys = Object.keys(patch);
  if (keys.length === 0) return 'No changes';
  if (keys.length <= 3) return `Edited ${keys.join(', ')}`;
  return `Edited ${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`;
}
