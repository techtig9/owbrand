import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText, socialPlatformSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { build30DayCalendar } from '@/lib/marketing/calendar';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Authenticated + brand-authorized (was fully open). */
const Body = z.object({
  brandId: uuidSchema,
  platforms: z.array(socialPlatformSchema).min(1).max(7).optional(),
  primaryProduct: boundedText(0, 200).optional(),
});

export const POST = routeHandler('/api/marketing/calendar', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  await assertBrandAccess(user.id, body.brandId, { db: supabaseAdmin() });

  return NextResponse.json({
    calendar: build30DayCalendar(body.platforms ?? ['instagram'], body.primaryProduct),
  });
});
