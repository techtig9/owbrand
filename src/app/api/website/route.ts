import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseSearchParams, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadSite, listSiteRevisions } from '@/lib/website/store';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/** The whole site, ordered, for the editor and the preview renderer. */
export const GET = routeHandler('/api/website', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { brandId } = parseSearchParams(request, z.object({ brandId: uuidSchema }));
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, brandId, { db });

  const [pages, revisions] = await Promise.all([loadSite(brandId, db), listSiteRevisions(brandId, db)]);

  return NextResponse.json({
    pages,
    revisions,
    exists: pages.length > 0,
  });
});
