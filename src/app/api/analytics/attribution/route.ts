import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { summarizeAttribution } from '@/lib/analytics/attribution';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Attribution summary over the brand's STORED touchpoints.
 *
 * Previously unauthenticated and it summarised whatever touchpoint array the
 * caller posted — which is not analytics, it is arithmetic on user input. Now
 * authenticated, brand-authorized, and reading attribution_touchpoints.
 */
const Body = z.object({
  brandId: uuidSchema,
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const POST = routeHandler('/api/analytics/attribution', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();
  await assertBrandAccess(user.id, body.brandId, { db });

  let query = db
    .from('attribution_touchpoints')
    .select('platform, occurred_at, clicks, conversions, revenue')
    .eq('brand_id', body.brandId)
    .order('occurred_at', { ascending: false })
    .limit(5000);

  if (body.from) query = query.gte('occurred_at', body.from);
  if (body.to) query = query.lte('occurred_at', body.to);

  const { data, error } = await query;
  if (error) throw error;

  const touchpoints = (data ?? []) as Array<Record<string, unknown>>;

  return NextResponse.json({
    summary: summarizeAttribution(touchpoints as never),
    touchpointCount: touchpoints.length,
    // Be explicit when there is nothing real to summarise, rather than
    // returning confident-looking zeros.
    hasData: touchpoints.length > 0,
  });
});
