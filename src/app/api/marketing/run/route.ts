import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText, socialPlatformSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { buildMarketingRun } from '@/lib/marketing/run-marketing';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * SECURITY FIX (Phase 1)
 * Previously unauthenticated and accepted an arbitrary brandId, so anyone could
 * generate a marketing plan against any tenant's brand id. Now authenticated
 * and brand-authorized.
 */
const Body = z.object({
  brandId: uuidSchema,
  platforms: z.array(socialPlatformSchema).min(1).max(7).optional(),
  primaryProduct: boundedText(0, 200).optional(),
  metrics: z.record(z.number().finite()).optional(),
  campaign: z
    .object({
      name: boundedText(1, 160),
      goal: z.enum(['awareness', 'engagement', 'traffic', 'leads', 'sales', 'launch', 'retention']),
    })
    .optional(),
});

export const POST = routeHandler('/api/marketing/run', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  await assertBrandAccess(user.id, body.brandId, { db: supabaseAdmin() });

  return NextResponse.json(
    buildMarketingRun({
      brandId: body.brandId,
      platforms: body.platforms ?? ['instagram'],
      primaryProduct: body.primaryProduct,
      metrics: body.metrics ?? {},
      campaign: body.campaign,
    })
  );
});
