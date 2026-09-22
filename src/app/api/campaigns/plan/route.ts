import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText, socialPlatformSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { buildCampaignPlan } from '@/lib/campaigns/planner';
import type { CampaignBrief } from '@/lib/campaigns/types';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Authenticated + brand-authorized (was fully open, accepting any brandId). */
const Body = z.object({
  brandId: uuidSchema,
  name: boundedText(1, 160),
  goal: z.enum(['awareness', 'engagement', 'traffic', 'leads', 'sales', 'launch', 'retention']),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  platforms: z.array(socialPlatformSchema).min(1).max(7).optional(),
  budget: z.number().finite().nonnegative().max(100_000_000).optional(),
});

export const POST = routeHandler('/api/campaigns/plan', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  await assertBrandAccess(user.id, body.brandId, { db: supabaseAdmin() });

  if (new Date(body.endDate) <= new Date(body.startDate)) {
    return NextResponse.json(
      { error: 'The end date must be after the start date.', code: 'invalid_request' },
      { status: 400 }
    );
  }

  const brief = {
    ...body,
    platforms: body.platforms ?? ['instagram'],
  } as unknown as CampaignBrief;

  return NextResponse.json({ plan: buildCampaignPlan(brief) });
});
