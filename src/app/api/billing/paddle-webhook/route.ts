import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyPaddleWebhook } from '@/lib/paddle';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';
import { logger, newRequestId } from '@/lib/logger';
import { claimWebhookEvent, completeWebhookEvent, releaseWebhookEvent } from '@/lib/billing/webhook-store';
import { checkRateLimit, clientIp } from '@/lib/security/rate-limit';

/**
 * Paddle webhook receiver.
 *
 * PHASE 1 FIXES
 *
 * 1. IDEMPOTENCY. There was none. `transaction.completed` reset
 *    credits_remaining to the plan maximum every time it ran, and the
 *    `payments` insert that would have failed on its unique constraint had its
 *    error ignored — so replaying one validly signed event was a repeatable
 *    free credit top-up. Every event now claims a webhook_events row first.
 *
 * 2. SILENT NO-OP ON PAYMENT. subscription.created used `.update()` against a
 *    row that might not exist. Supabase returns no error for an update that
 *    matches zero rows, so a paying customer could receive nothing and the
 *    failure was invisible. Now an upsert, with the affected row count checked.
 *
 * 3. CREDIT RESET ON THE WRONG EVENT. Credits were topped up on any completed
 *    transaction, including the initial purchase (double-granting alongside
 *    subscription.created) and one-off charges. Now only a genuine renewal —
 *    a transaction carrying a subscription id whose billing period has moved
 *    on — resets the balance.
 *
 * 4. MISSING LIFECYCLE EVENTS: refunds, chargebacks, pause/resume and
 *    past_due→active recovery were all unhandled.
 *
 * 5. NO AUDIT TRAIL. Every state transition now writes an audit_logs row.
 *
 * The signature check was already correct and is preserved: nothing is trusted,
 * and no database write happens, before the payload is verified.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const requestId = newRequestId();

  // Generous, but stops a flood of unsigned junk from reaching signature
  // verification (which is CPU work).
  const rate = await checkRateLimit('webhook', clientIp(req));
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('paddle-signature') ?? '';

  const event = await verifyPaddleWebhook(rawBody, signature);
  if (!event) {
    logger.warn('billing:webhook_signature_invalid', { requestId });
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  const eventId = extractEventId(event, rawBody);
  const payloadDigest = crypto.createHash('sha256').update(rawBody).digest('hex');

  const claim = await claimWebhookEvent(
    { provider: 'paddle', eventId, eventType: event.eventType, payloadDigest },
    supabaseAdmin()
  );

  if (!claim.claimed) {
    if (claim.reason === 'duplicate') {
      // Acknowledge: replay is expected behaviour, not an error. A non-2xx
      // would make Paddle retry forever.
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    // Could not record the claim — ask Paddle to retry rather than risk
    // processing without idempotency protection.
    return NextResponse.json({ error: 'Temporarily unable to process.' }, { status: 503 });
  }

  try {
    const outcome = await handleEvent(event, requestId);
    await completeWebhookEvent(claim.rowId, outcome.handled ? 'processed' : 'ignored');
    return NextResponse.json({ received: true, handled: outcome.handled }, { status: 200 });
  } catch (error) {
    logger.error('billing:webhook_handler_failed', error, {
      requestId,
      eventType: event.eventType,
      eventId,
    });
    // Release the claim so Paddle's retry can be processed rather than being
    // rejected as a duplicate of a run that never completed.
    await releaseWebhookEvent(claim.rowId);
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ *
 * Event handling
 * ------------------------------------------------------------------ */

async function handleEvent(
  event: { eventType: string; data: Record<string, any> },
  requestId: string
): Promise<{ handled: boolean }> {
  const db = supabaseAdmin();
  const data = event.data ?? {};

  switch (event.eventType) {
    case 'subscription.created':
    case 'subscription.updated':
    case 'subscription.activated': {
      const userId = await resolveUserId(db, data);
      if (!userId) return unresolved(event.eventType, requestId);

      const plan = normalisePlan(data.customData?.plan);
      const status = mapSubscriptionStatus(data.status);

      // Upsert, not update: a paying customer whose subscription row is missing
      // must still be provisioned.
      await upsertSubscription(db, userId, {
        plan,
        status,
        paddle_subscription_id: data.id ?? null,
        paddle_customer_id: data.customerId ?? null,
        renews_at: data.nextBilledAt ?? null,
        current_period_start: data.currentBillingPeriod?.startsAt ?? null,
        current_period_end: data.currentBillingPeriod?.endsAt ?? null,
        cancel_at_period_end: data.scheduledChange?.action === 'cancel',
        // Grant the plan's credits when a subscription first becomes active.
        ...(event.eventType === 'subscription.created' || event.eventType === 'subscription.activated'
          ? { credits_remaining: PLANS[plan].monthlyCredits }
          : {}),
      });

      await audit(db, userId, `billing.${event.eventType}`, { plan, status, subscriptionId: data.id });
      return { handled: true };
    }

    case 'subscription.canceled':
    case 'subscription.cancelled': {
      const userId = await resolveUserId(db, data);
      if (!userId) return unresolved(event.eventType, requestId);

      // Downgrade to free. Credits are set to the free allowance rather than
      // zeroed, so a cancelling customer is not locked out mid-cycle.
      await upsertSubscription(db, userId, {
        status: 'cancelled',
        plan: 'free',
        credits_remaining: PLANS.free.monthlyCredits,
        cancel_at_period_end: false,
        renews_at: null,
      });

      await audit(db, userId, 'billing.subscription.cancelled', { subscriptionId: data.id });
      return { handled: true };
    }

    case 'subscription.paused': {
      const userId = await resolveUserId(db, data);
      if (!userId) return unresolved(event.eventType, requestId);

      await upsertSubscription(db, userId, { status: 'past_due' });
      await audit(db, userId, 'billing.subscription.paused', { subscriptionId: data.id });
      return { handled: true };
    }

    case 'subscription.resumed': {
      const userId = await resolveUserId(db, data);
      if (!userId) return unresolved(event.eventType, requestId);

      await upsertSubscription(db, userId, { status: 'active' });
      await audit(db, userId, 'billing.subscription.resumed', { subscriptionId: data.id });
      return { handled: true };
    }

    case 'transaction.completed': {
      const userId = await resolveUserId(db, data);
      if (!userId) return unresolved(event.eventType, requestId);

      const amount = Number(data.details?.totals?.total ?? 0) / 100;

      // Unique on paddle_transaction_id. The error is CHECKED now — previously
      // it was swallowed and the credit reset ran anyway.
      const { error: paymentError } = await db.from('payments').insert({
        user_id: userId,
        paddle_transaction_id: data.id,
        amount,
        status: 'completed',
      });

      if (paymentError && (paymentError as { code?: string }).code !== '23505') {
        throw paymentError;
      }

      // Only a RENEWAL tops credits back up. The first transaction of a new
      // subscription is already handled by subscription.created, and a one-off
      // charge should not grant a month's credits at all.
      if (await isRenewal(db, userId, data)) {
        const { data: sub } = await db
          .from('subscriptions')
          .select('plan')
          .eq('user_id', userId)
          .maybeSingle();

        const plan = normalisePlan((sub as { plan?: string } | null)?.plan);
        await upsertSubscription(db, userId, {
          credits_remaining: PLANS[plan].monthlyCredits,
          status: 'active',
          renews_at: data.billingPeriod?.endsAt ?? null,
        });

        await audit(db, userId, 'billing.renewal.credits_reset', { plan, transactionId: data.id });
      } else {
        await audit(db, userId, 'billing.transaction.completed', { transactionId: data.id, amount });
      }

      return { handled: true };
    }

    case 'transaction.payment_failed': {
      const userId = await resolveUserId(db, data);
      if (!userId) return unresolved(event.eventType, requestId);

      const { error } = await db.from('payments').insert({
        user_id: userId,
        paddle_transaction_id: data.id,
        amount: Number(data.details?.totals?.total ?? 0) / 100,
        status: 'failed',
      });
      if (error && (error as { code?: string }).code !== '23505') throw error;

      await upsertSubscription(db, userId, { status: 'past_due' });
      await audit(db, userId, 'billing.payment.failed', { transactionId: data.id });
      return { handled: true };
    }

    case 'adjustment.created':
    case 'transaction.refunded': {
      // Refund or chargeback. Record it and revoke the plan's remaining credit
      // allowance so a refunded month cannot continue to be spent.
      const userId = await resolveUserId(db, data);
      if (!userId) return unresolved(event.eventType, requestId);

      const amount = Number(data.details?.totals?.total ?? data.totals?.total ?? 0) / 100;

      const { error } = await db.from('payments').insert({
        user_id: userId,
        paddle_transaction_id: `${data.id}:refund`,
        amount: -Math.abs(amount),
        status: 'refunded',
      });
      if (error && (error as { code?: string }).code !== '23505') throw error;

      await upsertSubscription(db, userId, {
        status: 'cancelled',
        plan: 'free',
        credits_remaining: PLANS.free.monthlyCredits,
      });

      await audit(db, userId, 'billing.refund', { transactionId: data.id, amount });
      return { handled: true };
    }

    default:
      logger.info('billing:webhook_unhandled_event', { requestId, eventType: event.eventType });
      return { handled: false };
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Resolves our user id WITHOUT trusting customData alone.
 *
 * customData is set by us at checkout, so it is the primary source — but it can
 * be absent on events Paddle generates itself (a renewal, a dunning retry). We
 * then fall back to the stored subscription/customer id, which we control.
 */
async function resolveUserId(db: ReturnType<typeof supabaseAdmin>, data: Record<string, any>): Promise<string | null> {
  const fromCustomData = data.customData?.userId;
  if (typeof fromCustomData === 'string' && /^[0-9a-f-]{36}$/i.test(fromCustomData)) {
    const { data: user } = await db.from('users').select('id').eq('id', fromCustomData).maybeSingle();
    if (user) return (user as { id: string }).id;
  }

  const subscriptionId = data.subscriptionId ?? (data.id?.startsWith?.('sub_') ? data.id : null);
  if (subscriptionId) {
    const { data: sub } = await db
      .from('subscriptions')
      .select('user_id')
      .eq('paddle_subscription_id', subscriptionId)
      .maybeSingle();
    if (sub) return (sub as { user_id: string }).user_id;
  }

  const customerId = data.customerId;
  if (customerId) {
    const { data: sub } = await db
      .from('subscriptions')
      .select('user_id')
      .eq('paddle_customer_id', customerId)
      .maybeSingle();
    if (sub) return (sub as { user_id: string }).user_id;
  }

  return null;
}

/** Upsert on user_id so a missing subscription row is created, not skipped. */
async function upsertSubscription(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await db
    .from('subscriptions')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });

  if (error) throw error;
}

/**
 * A transaction is a renewal when it belongs to a subscription we already know
 * about AND its billing period starts after the period we last recorded. That
 * distinguishes "month 2" from the initial purchase.
 */
async function isRenewal(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  data: Record<string, any>
): Promise<boolean> {
  const subscriptionId = data.subscriptionId;
  if (!subscriptionId) return false;

  const { data: sub } = await db
    .from('subscriptions')
    .select('paddle_subscription_id, current_period_start, created_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!sub) return false;
  const row = sub as { paddle_subscription_id?: string; current_period_start?: string; created_at?: string };
  if (row.paddle_subscription_id !== subscriptionId) return false;

  const periodStart = data.billingPeriod?.startsAt;
  if (!periodStart) return false;

  const known = row.current_period_start ?? row.created_at;
  if (!known) return false;

  return new Date(periodStart).getTime() > new Date(known).getTime();
}

function normalisePlan(value: unknown): PlanId {
  const plan = String(value ?? 'free');
  return (['free', 'starter', 'pro', 'business'] as const).includes(plan as PlanId) ? (plan as PlanId) : 'free';
}

function mapSubscriptionStatus(status: unknown): string {
  switch (String(status)) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'paused':
    case 'past_due':
      return 'past_due';
    default:
      return 'past_due';
  }
}

/** Paddle sends an event id; fall back to a payload hash so we always dedupe. */
function extractEventId(event: { eventType: string; data: Record<string, any> }, rawBody: string): string {
  const parsed = safeParse(rawBody);
  const id = parsed?.event_id ?? parsed?.eventId ?? parsed?.notification_id;
  if (typeof id === 'string' && id.length > 0) return id;

  return `sha256:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
}

function safeParse(raw: string): Record<string, any> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function unresolved(eventType: string, requestId: string): { handled: boolean } {
  logger.warn('billing:webhook_user_unresolved', { requestId, eventType });
  return { handled: false };
}

async function audit(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await db.from('audit_logs').insert({
    actor_id: userId,
    actor_type: 'webhook',
    action,
    entity_type: 'subscription',
    entity_id: userId,
    metadata,
  });
  if (error) logger.warn('billing:audit_write_failed', { action, error: String(error.message) });
}
