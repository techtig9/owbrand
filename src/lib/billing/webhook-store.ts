/**
 * Webhook idempotency.
 *
 * The Paddle handler previously had no deduplication at all. Worse, its
 * `transaction.completed` branch reset `credits_remaining` to the plan maximum
 * on EVERY occurrence, and the `payments` insert that would have failed on the
 * unique paddle_transaction_id had its error ignored — so replaying one validly
 * signed event was a repeatable free credit top-up.
 *
 * Every event now claims a row in `webhook_events` first. The unique
 * (provider, event_id) constraint means a replay loses the race and is
 * acknowledged without re-running any side effect.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

type Db = SupabaseClient<any, any, any>;

export type ClaimOutcome =
  | { claimed: true; rowId: string }
  | { claimed: false; reason: 'duplicate'; previousStatus: string }
  | { claimed: false; reason: 'error' };

/**
 * Attempts to claim an event for processing.
 *
 * Returns claimed:false for anything already seen. Callers must treat that as
 * success (HTTP 200) — Paddle retries on non-2xx, and a duplicate is not an
 * error, it is the system working.
 */
export async function claimWebhookEvent(
  input: { provider?: string; eventId: string; eventType: string; payloadDigest?: string },
  db: Db = supabaseAdmin()
): Promise<ClaimOutcome> {
  const provider = input.provider ?? 'paddle';

  const { data, error } = await db
    .from('webhook_events')
    .insert({
      provider,
      event_id: input.eventId,
      event_type: input.eventType,
      status: 'processing',
      payload_digest: input.payloadDigest ?? null,
    })
    .select('id')
    .single();

  if (!error && data) {
    return { claimed: true, rowId: (data as { id: string }).id };
  }

  // 23505 = unique_violation → this event has already been claimed.
  if (error && (error as { code?: string }).code === '23505') {
    const { data: existing } = await db
      .from('webhook_events')
      .select('status')
      .eq('provider', provider)
      .eq('event_id', input.eventId)
      .maybeSingle();

    logger.info('billing:webhook_duplicate_ignored', {
      provider,
      eventId: input.eventId,
      eventType: input.eventType,
      previousStatus: (existing as { status?: string } | null)?.status,
    });

    return {
      claimed: false,
      reason: 'duplicate',
      previousStatus: (existing as { status?: string } | null)?.status ?? 'unknown',
    };
  }

  logger.error('billing:webhook_claim_failed', error, { provider, eventId: input.eventId });
  return { claimed: false, reason: 'error' };
}

/** Marks a claimed event finished. */
export async function completeWebhookEvent(
  rowId: string,
  status: 'processed' | 'failed' | 'ignored',
  error?: string,
  db: Db = supabaseAdmin()
): Promise<void> {
  const { error: updateError } = await db
    .from('webhook_events')
    .update({
      status,
      error: error ? error.slice(0, 500) : null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', rowId);

  if (updateError) {
    logger.warn('billing:webhook_complete_failed', { rowId, status, error: String(updateError.message) });
  }
}

/**
 * A failed event is released so Paddle's retry can pick it up again. Without
 * this, one transient database blip would permanently poison the event id.
 */
export async function releaseWebhookEvent(rowId: string, db: Db = supabaseAdmin()): Promise<void> {
  const { error } = await db.from('webhook_events').delete().eq('id', rowId);
  if (error) {
    logger.warn('billing:webhook_release_failed', { rowId, error: String(error.message) });
  }
}
