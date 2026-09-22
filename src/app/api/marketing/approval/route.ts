import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { canExecuteAction } from '@/lib/marketing/approval';
import { loadApprovalPolicy } from '@/lib/marketing/policy-store';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * SECURITY FIX (Phase 1)
 * Previously unauthenticated AND it accepted the approval policy itself from
 * the request body — so a caller could declare `autonomous` with
 * `auto_spend_money: true` and be told every action was permitted. The policy
 * is now read from the brand's stored record; the body cannot supply one.
 */
const ACTIONS = ['generate', 'schedule', 'publish', 'spend'] as const;

const Body = z.object({
  brandId: uuidSchema,
  actions: z.array(z.enum(ACTIONS)).min(1).max(4),
});

export const POST = routeHandler('/api/marketing/approval', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();
  await assertBrandAccess(user.id, body.brandId, { db });

  const policy = await loadApprovalPolicy(body.brandId, db);

  const allowed = body.actions.filter((action) => canExecuteAction(policy, action));

  return NextResponse.json({
    policy,
    requestedActions: body.actions,
    allowedActions: allowed,
    blockedActions: body.actions.filter((action) => !allowed.includes(action)),
  });
});

