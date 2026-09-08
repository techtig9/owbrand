import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * SECURITY FIX (Phase 1)
 *
 * Before, this endpoint was unauthenticated and returned the caller's own
 * request back to them as authorization state:
 *
 *     role:   body.role   ?? 'owner'
 *     planId: body.planId ?? 'free'
 *
 * Anyone could claim to be an owner of any workspace on any plan. Every field
 * is now derived from the session and the database; the request body may only
 * name WHICH workspace is being asked about, never what the caller is.
 */

const Body = z.object({ workspaceId: uuidSchema.optional() });

export const POST = routeHandler('/api/workspace/context', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();

  // Resolve the workspace: the one requested (if the caller belongs to it), or
  // the one they own.
  let workspaceId = body.workspaceId ?? null;
  let role: string | null = null;

  if (workspaceId) {
    const { data: owned } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('owner_id', user.id)
      .maybeSingle();

    if (owned) {
      role = 'owner';
    } else {
      const { data: membership } = await db
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!membership) throw ApiError.notFound('Workspace not found.');
      role = (membership as { role: string }).role;
    }
  } else {
    const { data: workspace } = await db
      .from('workspaces')
      .select('id')
      .eq('owner_id', user.id)
      .order('created_at')
      .limit(1)
      .maybeSingle();

    if (!workspace) throw ApiError.notFound('No workspace available for this account.');
    workspaceId = (workspace as { id: string }).id;
    role = 'owner';
  }

  // Plan comes from the subscription record, never from the request.
  const { data: subscription } = await db
    .from('subscriptions')
    .select('plan, status')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    workspaceId,
    role,
    planId: (subscription as { plan?: string } | null)?.plan ?? 'free',
    subscriptionStatus: (subscription as { status?: string } | null)?.status ?? 'active',
    userId: user.id,
  });
});
