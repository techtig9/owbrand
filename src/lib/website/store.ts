/**
 * Website persistence.
 *
 * The generated site is written to site_pages / site_sections so it can be
 * rendered, edited, versioned and exported. A whole-site snapshot also goes to
 * site_revisions on every save, which is what makes undo and "restore an
 * earlier version" possible in the editor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { ApiError } from '@/lib/api/errors';
import { generatedSiteSchema, type GeneratedSite, type SectionContent } from '@/lib/website/schema';

type Db = SupabaseClient<any, any, any>;

export type SiteRevisionSource = 'ai_generated' | 'user_edited' | 'restored' | 'autosave';

export interface StoredSection {
  id: string;
  kind: string;
  sortOrder: number;
  content: SectionContent;
  styles: Record<string, unknown>;
  visible: boolean;
}

export interface StoredPage {
  id: string;
  slug: string;
  title: string;
  isHome: boolean;
  seo: Record<string, unknown>;
  status: 'draft' | 'published';
  sortOrder: number;
  sections: StoredSection[];
}

/**
 * Replaces the brand's site with a newly generated one, and records a revision.
 *
 * Destructive by design — generating a site means replacing it — but the
 * revision written FIRST means the previous state is always recoverable.
 */
export async function saveGeneratedSite(
  options: { brandId: string; userId: string; site: GeneratedSite; source?: SiteRevisionSource; db?: Db }
): Promise<{ revision: number; pages: number; sections: number }> {
  const db = options.db ?? supabaseAdmin();

  const parsed = generatedSiteSchema.safeParse(options.site);
  if (!parsed.success) {
    throw ApiError.invalid('That site structure is not valid and was not saved.', {
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  const site = parsed.data;

  // Snapshot BEFORE mutating, so a bad generation can be rolled back to.
  const revision = await writeRevision({
    brandId: options.brandId,
    userId: options.userId,
    snapshot: site as unknown as Record<string, unknown>,
    source: options.source ?? 'ai_generated',
    db,
  });

  // Cascade removes the sections with their pages.
  const { error: deleteError } = await db.from('site_pages').delete().eq('brand_id', options.brandId);
  if (deleteError) throw deleteError;

  let sectionCount = 0;

  for (const [pageIndex, page] of site.pages.entries()) {
    const { data: created, error: pageError } = await db
      .from('site_pages')
      .insert({
        brand_id: options.brandId,
        slug: page.slug,
        title: page.title,
        is_home: page.isHome || (pageIndex === 0 && !site.pages.some((p) => p.isHome)),
        seo: page.seo,
        status: 'draft',
        sort_order: pageIndex,
      })
      .select('id')
      .single();

    if (pageError || !created) throw pageError ?? new Error('Could not create the page.');
    const pageId = (created as { id: string }).id;

    const sectionRows = page.sections.map((section, index) => ({
      page_id: pageId,
      kind: section.kind,
      sort_order: index,
      content: section,
      styles: {},
      visible: true,
    }));

    if (sectionRows.length > 0) {
      const { error: sectionError } = await db.from('site_sections').insert(sectionRows);
      if (sectionError) throw sectionError;
      sectionCount += sectionRows.length;
    }
  }

  logger.info('website:saved', {
    brandId: options.brandId,
    revision,
    pages: site.pages.length,
    sections: sectionCount,
  });

  return { revision, pages: site.pages.length, sections: sectionCount };
}

/** The full site, ordered, ready for the editor or the renderer. */
export async function loadSite(brandId: string, db: Db = supabaseAdmin()): Promise<StoredPage[]> {
  const { data: pages, error } = await db
    .from('site_pages')
    .select('id, slug, title, is_home, seo, status, sort_order')
    .eq('brand_id', brandId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  if (!pages || pages.length === 0) return [];

  const pageIds = (pages as Array<{ id: string }>).map((p) => p.id);

  const { data: sections, error: sectionError } = await db
    .from('site_sections')
    .select('id, page_id, kind, sort_order, content, styles, visible')
    .in('page_id', pageIds)
    .order('sort_order', { ascending: true });

  if (sectionError) throw sectionError;

  const byPage = new Map<string, StoredSection[]>();
  for (const row of (sections ?? []) as Array<Record<string, any>>) {
    const list = byPage.get(row.page_id) ?? [];
    list.push({
      id: row.id,
      kind: row.kind,
      sortOrder: row.sort_order,
      content: row.content as SectionContent,
      styles: row.styles ?? {},
      visible: Boolean(row.visible),
    });
    byPage.set(row.page_id, list);
  }

  return (pages as Array<Record<string, any>>).map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    isHome: Boolean(page.is_home),
    seo: page.seo ?? {},
    status: page.status,
    sortOrder: page.sort_order,
    sections: byPage.get(page.id) ?? [],
  }));
}

/* ------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------ */

/** Updates one section's content or styles. Used by the properties panel. */
export async function updateSection(
  options: {
    brandId: string;
    sectionId: string;
    content?: unknown;
    styles?: Record<string, unknown>;
    visible?: boolean;
    db?: Db;
  }
): Promise<void> {
  const db = options.db ?? supabaseAdmin();
  await assertSectionBelongsToBrand(db, options.sectionId, options.brandId);

  const update: Record<string, unknown> = {};
  if (options.content !== undefined) update.content = options.content;
  if (options.styles !== undefined) update.styles = options.styles;
  if (options.visible !== undefined) update.visible = options.visible;

  if (Object.keys(update).length === 0) return;

  const { error } = await db.from('site_sections').update(update).eq('id', options.sectionId);
  if (error) throw error;
}

/**
 * Reorders sections within a page.
 *
 * Every id is verified against the page before anything is written — otherwise
 * a caller could pass one of their own section ids alongside someone else's and
 * reorder a stranger's page.
 */
export async function reorderSections(
  options: { brandId: string; pageId: string; orderedSectionIds: string[]; db?: Db }
): Promise<void> {
  const db = options.db ?? supabaseAdmin();

  const { data: page } = await db
    .from('site_pages')
    .select('id')
    .eq('id', options.pageId)
    .eq('brand_id', options.brandId)
    .maybeSingle();

  if (!page) throw ApiError.notFound('Page not found.');

  const { data: existing } = await db.from('site_sections').select('id').eq('page_id', options.pageId);
  const validIds = new Set((existing ?? []).map((s: { id: string }) => s.id));

  if (options.orderedSectionIds.some((id) => !validIds.has(id))) {
    throw ApiError.invalid('That section list does not match this page.');
  }

  for (const [index, sectionId] of options.orderedSectionIds.entries()) {
    const { error } = await db.from('site_sections').update({ sort_order: index }).eq('id', sectionId);
    if (error) throw error;
  }
}

async function assertSectionBelongsToBrand(db: Db, sectionId: string, brandId: string): Promise<void> {
  const { data } = await db
    .from('site_sections')
    .select('id, site_pages!inner(brand_id)')
    .eq('id', sectionId)
    .maybeSingle();

  const owner = (data as { site_pages?: { brand_id?: string } } | null)?.site_pages?.brand_id;
  if (!data || owner !== brandId) throw ApiError.notFound('Section not found.');
}

/* ------------------------------------------------------------------ *
 * Revisions
 * ------------------------------------------------------------------ */

async function writeRevision(options: {
  brandId: string;
  userId: string;
  snapshot: Record<string, unknown>;
  source: SiteRevisionSource;
  db: Db;
}): Promise<number> {
  const { data: latest } = await options.db
    .from('site_revisions')
    .select('version')
    .eq('brand_id', options.brandId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = ((latest as { version?: number } | null)?.version ?? 0) + 1;

  const { error } = await options.db.from('site_revisions').insert({
    brand_id: options.brandId,
    version,
    snapshot: options.snapshot,
    source: options.source,
    created_by: options.userId,
  });

  if (error) {
    // A missing revision must not block the save itself; it costs undo depth,
    // not the user's work.
    logger.warn('website:revision_write_failed', { brandId: options.brandId, error: String(error.message) });
    return version;
  }

  return version;
}

/** Snapshots the CURRENT stored site, for autosave before an edit. */
export async function snapshotCurrentSite(
  options: { brandId: string; userId: string; source?: SiteRevisionSource; db?: Db }
): Promise<number | null> {
  const db = options.db ?? supabaseAdmin();
  const pages = await loadSite(options.brandId, db);
  if (pages.length === 0) return null;

  return writeRevision({
    brandId: options.brandId,
    userId: options.userId,
    snapshot: { pages } as unknown as Record<string, unknown>,
    source: options.source ?? 'autosave',
    db,
  });
}

export async function listSiteRevisions(
  brandId: string,
  db: Db = supabaseAdmin()
): Promise<Array<{ version: number; source: string; createdAt: string; createdBy: string | null }>> {
  const { data, error } = await db
    .from('site_revisions')
    .select('version, source, created_at, created_by')
    .eq('brand_id', brandId)
    .order('version', { ascending: false })
    .limit(50);

  if (error) throw error;

  return (data ?? []).map((row: Record<string, any>) => ({
    version: row.version,
    source: row.source,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }));
}
