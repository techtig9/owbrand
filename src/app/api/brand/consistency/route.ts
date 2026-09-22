import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { getCurrentBrandBrain } from '@/lib/brand/store';
import { checkConsistency, coverage } from '@/lib/brand/consistency';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * Check arbitrary copy against a brand.
 *
 * **No credits, no AI call.** Every check is deterministic, which is what
 * makes it usable the way a spell-checker is usable — a user can run it on
 * fifty captions without thinking about cost. Putting a credit charge on this
 * would make people ration the one feature that should be constant.
 *
 * Rate limited on `standard` rather than a generation tier for the same
 * reason: the limit is there to stop a loop, not to meter value.
 */

const Body = z.object({
  brandId: uuidSchema,
  // 20k characters: a long-form page, not a book. Larger inputs are a sign of
  // someone pasting a whole site, which this is not built to review in one go.
  text: boundedText(1, 20_000),
});

export const POST = routeHandler('/api/brand/consistency', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { brandId, text } = await parseJsonBody(request, Body);

  const db = supabaseAdmin();
  await assertBrandAccess(user.id, brandId, { db });

  const brain = await getCurrentBrandBrain(brandId, db);

  if (!brain) {
    // Not an empty result. Returning a score of 100 for a brand with no Brain
    // would be the product claiming it verified something against nothing.
    throw ApiError.invalid(
      'This brand has no Brand Brain yet, so there is nothing to check against. Build one first.'
    );
  }

  const result = checkConsistency(text, brain);

  return NextResponse.json({
    ...result,
    /*
     * Shipped alongside the score so the UI can say "100, and we checked 2 of
     * 5 things" rather than a bare 100. A confident number from a thin Brand
     * Brain is the most misleading output this endpoint could produce.
     */
    coverage: coverage(brain),
  });
});
