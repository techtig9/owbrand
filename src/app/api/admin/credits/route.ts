import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, uuidSchema, boundedText } from '@/lib/api/validate';
import { requireAdminUser } from '@/lib/auth/guards';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Admin credit grants.
 *
 * The route checks the admin role and the database function checks it AGAIN.
 * That is not redundancy for its own sake: a privileged function that trusts
 * its caller's claim about themselves is one route bug away from being a
 * self-service credit machine, and the function is reachable by anything
 * holding the service-role key.
 *
 * There is deliberately no impersonation endpoint anywhere in this admin
 * surface. Support can grant credits and read state; it cannot act as a
 * customer. An impersonation feature makes every audit log ambiguous about who
 * really did something, and that ambiguity is permanent.
 */

const Body = z.object({
  userId: uuidSchema,
  amount: z.number().int().refine((value) => value !== 0, 'Amount must not be zero.'),
  // Required, and enforced again in the function. A grant without a reason is
  // the one thing an audit cannot reconstruct afterwards.
  reason: boundedText(3, 300),
});

export const POST = routeHandler('/api/admin/credits', async (request: Request) => {
  const admin = await requireAdminUser();
  const { userId, amount, reason } = await parseJsonBody(request, Body);

  const { data, error } = await supabaseAdmin().rpc('grant_credits', {
    p_admin_id: admin.id,
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
  });

  if (error) throw error;

  const result = (Array.isArray(data) ? data[0] : data) as
    | { granted: boolean; new_balance: number; detail: string | null }
    | undefined;

  if (!result?.granted) {
    // The function's refusals are all actionable by the admin (no reason, an
    // absurd amount, no subscription), so they are surfaced verbatim.
    throw ApiError.invalid(result?.detail ?? 'The grant was refused.');
  }

  logger.info('admin:credits_granted', { amount, newBalance: result.new_balance });

  return NextResponse.json({ granted: true, newBalance: result.new_balance });
});
