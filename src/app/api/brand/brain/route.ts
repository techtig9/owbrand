import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, boundedText, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getCurrentBrandBrain, updateBrandBrain } from '@/lib/brand/store';
import { brandBrainSchema } from '@/lib/brand/schema';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * Read and edit the current Brand Brain.
 *
 * "Editable AI decisions" is an explicit requirement: a user must be able to
 * correct what the AI decided rather than regenerate and hope. Every edit
 * creates a new version, so nothing is ever overwritten in place.
 */

export const GET = routeHandler('/api/brand/brain', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { brandId } = parseSearchParams(request, z.object({ brandId: uuidSchema }));
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, brandId, { db });

  const brain = await getCurrentBrandBrain(brandId, db);
  return NextResponse.json({ brain, exists: brain !== null });
});

/**
 * Patch the Brand Brain, section by section.
 *
 * Sections are REPLACED rather than deep-merged: an edit that removes an item
 * from a list must actually remove it, which a deep merge would silently undo.
 */
const PatchBody = z.object({
  brandId: uuidSchema,
  changeSummary: boundedText(0, 200).optional(),
  patch: z
    .object({
      name: brandBrainSchema.shape.name.optional(),
      tagline: brandBrainSchema.shape.tagline.optional(),
      story: brandBrainSchema.shape.story.optional(),
      business: brandBrainSchema.shape.business.optional(),
      positioning: brandBrainSchema.shape.positioning.optional(),
      audience: brandBrainSchema.shape.audience.optional(),
      voice: brandBrainSchema.shape.voice.optional(),
      visualIdentity: brandBrainSchema.shape.visualIdentity.optional(),
      guidelines: brandBrainSchema.shape.guidelines.optional(),
      contentStrategy: brandBrainSchema.shape.contentStrategy.optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, { message: 'Supply at least one section to change.' }),
});

export const PATCH = routeHandler('/api/brand/brain', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, PatchBody);
  const db = supabaseAdmin();

  await assertBrandAccess(user.id, body.brandId, { db });

  const version = await updateBrandBrain({
    brandId: body.brandId,
    userId: user.id,
    patch: body.patch as Record<string, unknown>,
    changeSummary: body.changeSummary,
    db,
  });

  return NextResponse.json({
    version: version.version,
    brain: version.brain,
    changeSummary: version.changeSummary,
  });
});
