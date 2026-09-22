import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/validate';
import { requireUser } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Account deletion.
 *
 * This route exists because the privacy policy promises it. A policy that
 * says "you can delete your account from settings" next to a disabled button
 * is a false statement in a legal document, which is worse than having no
 * policy page at all.
 *
 * Order of operations, which is not arbitrary:
 *
 *   1. **`delete_user_account` first.** It runs in one transaction, refuses to
 *      remove the last admin, and writes the audit row BEFORE the delete —
 *      after the delete there is no actor left to attribute it to.
 *   2. **Then the Supabase Auth user.** The reverse order would cascade into
 *      `public.users` and destroy the row the function needs, skipping both
 *      the last-admin check and the audit record.
 *
 * If step 2 fails after step 1 succeeded, the account's data is gone but the
 * login still works — a session with no profile behind it. That is reported as
 * a 500 with an explicit instruction rather than a success, because telling
 * someone their account is deleted when they can still sign in is the kind of
 * failure that turns into a complaint to a regulator.
 */

const Body = z.object({
  /**
   * Typed confirmation. A checkbox is too easy to click through for something
   * with no undo, and the word is the account's own email so it cannot be
   * satisfied by muscle memory on a shared machine.
   */
  confirm: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export const POST = routeHandler('/api/account/delete', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('billing', user.id);

  const { confirm, reason } = await parseJsonBody(request, Body);

  if (confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw ApiError.invalid('Type your email address exactly to confirm deletion.');
  }

  const db = supabaseAdmin();

  /*
   * Best-effort revocation of provider tokens before the rows go.
   *
   * Marking them revoked does not call the platform's revoke endpoint — that
   * is per-platform work the product does not do yet, and pretending otherwise
   * in a comment would be the same lie as the disabled button. What it does
   * guarantee is that no scheduled job picks up a token belonging to an
   * account mid-deletion. FIXES.md lists the real revocation as outstanding.
   */
  await db
    .from('social_accounts')
    .update({ status: 'revoked', last_error: 'account deleted' })
    .eq('user_id', user.id);

  const { data, error } = await db.rpc('delete_user_account', {
    p_user_id: user.id,
    p_reason: reason?.slice(0, 500) ?? 'user_request',
  });

  if (error) {
    logger.error('account:delete_failed', { stage: 'rpc', message: error.message });
    throw new Error(`account deletion failed: ${error.message}`);
  }

  // The function returns a single row.
  const result = (Array.isArray(data) ? data[0] : data) as
    | { deleted: boolean; brands_removed: number; payments_retained: number; detail: string | null }
    | undefined;

  if (!result?.deleted) {
    // The only expected reason is the last-admin guard, and it is the one
    // refusal a user can act on, so it is surfaced verbatim.
    throw ApiError.invalid(result?.detail ?? 'Account deletion was refused.');
  }

  const { error: authError } = await db.auth.admin.deleteUser(user.id);

  if (authError) {
    logger.error('account:delete_partial', { stage: 'auth', message: authError.message });
    // Deliberately NOT a success. See the header note.
    throw new Error(
      'Your data was removed but the sign-in record could not be deleted. Contact support so it can be finished manually.'
    );
  }

  logger.info('account:deleted', {
    brandsRemoved: result.brands_removed,
    paymentsRetained: result.payments_retained,
  });

  return NextResponse.json({
    deleted: true,
    brandsRemoved: result.brands_removed,
    paymentsRetained: result.payments_retained,
  });
});
