import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listBrandBrainVersions, restoreBrandBrainVersion } from '@/lib/brand/store';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/** Version history. Newest first, content included so the UI can diff. */
export const GET = routeHandler('/api/brand/brain/versions', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { brandId } = parseSearchParams(request, z.object({ brandId: uuidSchema }));
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, brandId, { db });

  const versions = await listBrandBrainVersions(brandId, { db });

  return NextResponse.json({
    versions: versions.map((v) => ({
      version: v.version,
      source: v.source,
      createdAt: v.createdAt,
      createdBy: v.createdBy,
      changeSummary: v.changeSummary,
      restoredFromVersion: v.restoredFromVersion,
      brain: v.brain,
    })),
    current: versions[0]?.version ?? null,
  });
});

/**
 * Restore an earlier version.
 *
 * Creates a NEW version whose content is copied from the old one rather than
 * rolling back, so the record of what the brand looked like — and when — stays
 * intact and auditable.
 */
const RestoreBody = z.object({
  brandId: uuidSchema,
  version: z.number().int().positive(),
});

export const POST = routeHandler('/api/brand/brain/versions', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, RestoreBody);
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, body.brandId, { db });

  const restored = await restoreBrandBrainVersion({
    brandId: body.brandId,
    version: body.version,
    userId: user.id,
    db,
  });

  return NextResponse.json(
    {
      version: restored.version,
      restoredFrom: body.version,
      brain: restored.brain,
    },
    { status: 201 }
  );
});
