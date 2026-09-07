import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { optimize, type PerformanceSnapshot } from '@/lib/analytics/optimizer';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Optimization recommendations from the brand's STORED daily analytics.
 *
 * Previously unauthenticated and it optimised whatever snapshot the caller
 * posted. The master command is explicit that recommendations must come from
 * real stored analytics, so the snapshot is now aggregated server-side and the
 * response states plainly when there is not enough data to advise on.
 */
const Body = z.object({
  brandId: uuidSchema,
  days: z.number().int().min(1).max(365).optional(),
});

export const POST = routeHandler('/api/analytics/optimize', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();
  await assertBrandAccess(user.id, body.brandId, { db });

  const days = body.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await db
    .from('analytics_daily')
    .select('reach, impressions, engagements, clicks, conversions, video_views, spend, revenue')
    .eq('brand_id', body.brandId)
    .gte('metric_date', since);

  if (error) throw error;

  const rows = (data ?? []) as Array<Record<string, number>>;

  if (rows.length === 0) {
    return NextResponse.json({
      actions: [],
      hasData: false,
      windowDays: days,
      message:
        'No analytics have been ingested for this brand yet. Connect a platform to start collecting performance data.',
    });
  }

  const snapshot: PerformanceSnapshot = rows.reduce<PerformanceSnapshot>(
    (acc, row) => ({
      reach: acc.reach + Number(row.reach ?? 0),
      impressions: acc.impressions + Number(row.impressions ?? 0),
      engagements: acc.engagements + Number(row.engagements ?? 0),
      clicks: acc.clicks + Number(row.clicks ?? 0),
      conversions: acc.conversions + Number(row.conversions ?? 0),
      spend: acc.spend + Number(row.spend ?? 0),
      revenue: acc.revenue + Number(row.revenue ?? 0),
      videoViews: (acc.videoViews ?? 0) + Number(row.video_views ?? 0),
    }),
    { reach: 0, impressions: 0, engagements: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0, videoViews: 0 }
  );

  return NextResponse.json({
    actions: optimize(snapshot),
    hasData: true,
    windowDays: days,
    snapshot,
  });
});
