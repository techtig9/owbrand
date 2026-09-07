import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { generateMarketingRecommendations } from '@/lib/marketing/strategy';
import type { CampaignBrief } from '@/lib/campaigns/types';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Authenticated + brand-authorized (was fully open). */
const Body = z.object({
  brandId: uuidSchema,
  brief: z.record(z.unknown()),
  metrics: z.record(z.number().finite()).optional(),
});

export const POST = routeHandler('/api/marketing/recommendations', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  await assertBrandAccess(user.id, body.brandId, { db: supabaseAdmin() });

  // The brief is caller-supplied planning input, not authorization input — the
  // brandId above is what actually gates access.
  const brief = { ...(body.brief as object), brandId: body.brandId } as CampaignBrief;

  return NextResponse.json({
    recommendations: generateMarketingRecommendations(brief, body.metrics ?? {}),
  });
});
