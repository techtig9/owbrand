import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sectionContentSchema } from '@/lib/website/schema';
import { updateSection, reorderSections, snapshotCurrentSite } from '@/lib/website/store';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * Section editing — the right-hand properties panel and drag-to-reorder.
 *
 * Every mutation snapshots the current site first, which is what makes the
 * editor's undo real rather than a client-side illusion.
 */

const PatchBody = z.object({
  brandId: uuidSchema,
  sectionId: uuidSchema,
  content: sectionContentSchema.optional(),
  styles: z.record(z.unknown()).optional(),
  visible: z.boolean().optional(),
});

export const PATCH = routeHandler('/api/website/sections', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, PatchBody);
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, body.brandId, { db });

  if (body.content === undefined && body.styles === undefined && body.visible === undefined) {
    throw ApiError.invalid('Supply content, styles or visible.');
  }

  await snapshotCurrentSite({ brandId: body.brandId, userId: user.id, source: 'autosave', db });

  await updateSection({
    brandId: body.brandId,
    sectionId: body.sectionId,
    content: body.content,
    styles: body.styles,
    visible: body.visible,
    db,
  });

  return NextResponse.json({ ok: true, sectionId: body.sectionId });
});

const ReorderBody = z.object({
  brandId: uuidSchema,
  pageId: uuidSchema,
  orderedSectionIds: z.array(uuidSchema).min(1).max(20),
});

export const POST = routeHandler('/api/website/sections', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, ReorderBody);
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, body.brandId, { db });
  await snapshotCurrentSite({ brandId: body.brandId, userId: user.id, source: 'autosave', db });

  // reorderSections verifies every id against the page — otherwise a caller
  // could mix in one of their own section ids and reorder a stranger's page.
  await reorderSections({
    brandId: body.brandId,
    pageId: body.pageId,
    orderedSectionIds: body.orderedSectionIds,
    db,
  });

  return NextResponse.json({ ok: true });
});
