import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { canExecuteAction } from '@/lib/marketing/approval';
import { loadApprovalPolicy } from '@/lib/marketing/policy-store';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * SECURITY FIX (Phase 1)
 * Previously unauthenticated, and — like /api/marketing/approval — it took the
 * automation policy from the request body, so an anonymous caller could
 * authorise their own spend. Now authenticated, brand-authorized, and the
 * policy is read from the database.
 *
 * This endpoint evaluates what MAY run; it does not itself execute anything.
 * The worker that acts on these decisions arrives in Phase 3, and the response
 * says so rather than implying work has started.
 */
const ACTIONS = ['generate', 'schedule', 'publish', 'spend'] as const;

const Body = z.object({
  brandId: uuidSchema,
  runId: uuidSchema.optional(),
  actions: z.array(z.enum(ACTIONS)).min(1).max(4),
});

export const POST = routeHandler('/api/marketing/execute', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, Body);
  const db = supabaseAdmin();
  await assertBrandAccess(user.id, body.brandId, { db });

  const policy = await loadApprovalPolicy(body.brandId, db);

  const results = body.actions.map((action) => {
    const allowed = canExecuteAction(policy, action);
    return {
      action,
      allowed,
      mode: policy.level,
      status: allowed ? 'approved_pending_worker' : 'requires_approval',
    };
  });

  // Irreversible categories are worth an audit trail even at evaluation time.
  if (body.actions.some((a) => a === 'publish' || a === 'spend')) {
    await db
      .from('audit_logs')
      .insert({
        actor_id: user.id,
        actor_type: 'user',
        action: 'marketing.execute.evaluated',
        entity_type: 'brand',
        entity_id: body.brandId,
        metadata: { actions: body.actions, level: policy.level },
      })
      .then(({ error }) => {
        if (error) logger.warn('marketing_execute:audit_write_failed', { error: String(error.message) });
      });
  }

  return NextResponse.json({
    runId: body.runId ?? null,
    results,
    executionMode: policy.level,
    note: 'Evaluation only. The execution worker is delivered in Phase 3.',
  });
});
