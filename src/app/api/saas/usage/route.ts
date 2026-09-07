import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { getPlanLimit, hasCapacity, type UsageMetric } from '@/lib/saas/usage';
import type { PlanId as SaasPlanId } from '@/lib/saas/plans';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * SECURITY FIX (Phase 1)
 * Previously unauthenticated, and it took `plan` and `used` straight from the
 * request body — so a caller could ask "am I within my limits?" while
 * declaring their own plan and their own usage. Both now come from the
 * database; the body may only name which metric is being asked about.
 *
 * NOTE (carried into Phase 4): lib/saas/plans.ts defines a different plan set
 * (free/starter/growth/agency/enterprise) from the one billing actually uses
 * (free/starter/pro/business). PLAN_ALIAS bridges them so this endpoint
 * reports against the caller's real subscription instead of a default. The two
 * plan systems are unified in Phase 4.
 */

const Body = z.object({
  metric: z.enum([
    'ai_generations',
    'image_generations',
    'video_generations',
    'scheduled_posts',
    'published_posts',
    'team_members',
  ]),
});

const PLAN_ALIAS: Record<string, SaasPlanId> = {
  free: 'free',
  starter: 'starter',
  pro: 'growth',
  business: 'agency',
};

export const POST = routeHandler('/api/saas/usage', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const { metric } = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  const { data: subscription } = await db
    .from('subscriptions')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();

  const appPlan = (subscription as { plan?: string } | null)?.plan ?? 'free';
  const plan = PLAN_ALIAS[appPlan] ?? 'free';

  const used = await countUsage(db, user.id, metric);

  return NextResponse.json({
    plan: appPlan,
    metric,
    used,
    limit: getPlanLimit(plan, metric),
    allowed: hasCapacity(plan, metric, used),
  });
});

/** Counts real usage server-side. Never accepts a client-supplied figure. */
async function countUsage(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  metric: UsageMetric
): Promise<number> {
  const countContentAssets = async (types?: string[]) => {
    let query = db.from('content_assets').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (types) query = query.in('type', types);
    const { count } = await query;
    return count ?? 0;
  };

  switch (metric) {
    case 'ai_generations':
      return countContentAssets();

    case 'image_generations':
      return countContentAssets(['photo', 'logo']);

    case 'video_generations':
      return countContentAssets(['reel', 'video']);

    case 'scheduled_posts': {
      const { count } = await db
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'queued');
      return count ?? 0;
    }

    case 'published_posts': {
      const { count } = await db
        .from('scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'published');
      return count ?? 0;
    }

    case 'team_members': {
      const { data: workspaces } = await db.from('workspaces').select('id').eq('owner_id', userId);
      const workspaceIds = (workspaces ?? []).map((w: { id: string }) => w.id);
      if (workspaceIds.length === 0) return 0;

      const { count } = await db
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .in('workspace_id', workspaceIds);
      return count ?? 0;
    }

    default:
      return 0;
  }
}
