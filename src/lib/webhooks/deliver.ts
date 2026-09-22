import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signPayload } from '@/lib/webhooks/sign';
import { checkUrl } from '@/lib/security/safe-url';
import { logger } from '@/lib/logger';

/**
 * Outbound webhook delivery.
 *
 * This is the one place in the product that makes an HTTP request to an
 * address a customer chose, which makes it the one place where SSRF is a live
 * concern rather than a latent one. The URL is validated when the endpoint is
 * created AND again at send time: an endpoint created before the guard existed,
 * or one whose hostname now resolves somewhere else, must not be trusted
 * because it passed a check once.
 */

/** Events the product actually emits. Adding one means emitting it. */
export const WEBHOOK_EVENTS = [
  'post.published',
  'post.failed',
  'content.generated',
  'approval.decided',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/*
 * Matches the alias the worker and the auth guards use. A narrower generic
 * here would not be more type-safe — it would just refuse the client every
 * caller actually holds, which is how a `as never` cast gets added and the
 * type stops meaning anything.
 */
type Db = SupabaseClient<any, any, any>;

export interface EnqueueInput {
  /**
   * The brand the event belongs to. The owning user is resolved from it here,
   * rather than each caller passing a user id — the publishing worker, which
   * is the main emitter, holds neither a user row nor a user column, and
   * making every caller look one up is how one of them ends up passing the
   * wrong one and delivering a customer's event to another account.
   */
  brandId: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
}

/**
 * Queues a delivery for every endpoint subscribed to this event.
 *
 * Queued rather than sent inline, deliberately: a receiver that takes ten
 * seconds to respond must not add ten seconds to the publish that triggered
 * it, and a receiver that is down must not fail the customer's action. The
 * insert is the only synchronous cost.
 */
export async function enqueueWebhook(input: EnqueueInput, client?: Db): Promise<number> {
  /*
   * Takes the caller's client when there is one.
   *
   * The publishing worker threads a `db` through every call precisely so it
   * can be exercised without a live database. Reaching for `supabaseAdmin()`
   * here quietly opted this one call out of that — the worker's tests hung on
   * a real connection attempt, which is the visible symptom; the invisible one
   * is a worker whose behaviour depends on a client its caller never chose.
   */
  const db = client ?? supabaseAdmin();

  const { data: brand } = await db
    .from('brands')
    .select('user_id')
    .eq('id', input.brandId)
    .maybeSingle();

  if (!brand) {
    logger.warn('webhook:enqueue_no_brand', { event: input.event });
    return 0;
  }

  const { data: endpoints, error } = await db
    .from('webhook_endpoints')
    .select('id, brand_id, events')
    .eq('user_id', brand.user_id)
    .eq('enabled', true)
    .contains('events', [input.event]);
  if (error) {
    // Never rethrown into the caller's path. A failure to queue a notification
    // must not fail the publish that the customer actually asked for.
    logger.error('webhook:enqueue_failed', { event: input.event, message: error.message });
    return 0;
  }

  /*
   * An endpoint scoped to a brand receives only that brand's events; one with
   * a null brand_id receives all of them. Filtered here rather than in the
   * query because `brand_id is null or brand_id = x` through the client
   * builder is easy to get subtly wrong, and getting it wrong means one
   * customer's brand events arriving at another brand's endpoint.
   */
  const matching = (endpoints ?? []).filter(
    (endpoint) => endpoint.brand_id === null || endpoint.brand_id === input.brandId
  );

  if (matching.length === 0) return 0;

  const payload = {
    event: input.event,
    created: new Date().toISOString(),
    data: input.data,
  };

  const { error: insertError } = await db.from('webhook_deliveries').insert(
    matching.map((endpoint) => ({
      endpoint_id: endpoint.id,
      event_type: input.event,
      payload,
    }))
  );

  if (insertError) {
    logger.error('webhook:enqueue_insert_failed', { event: input.event, message: insertError.message });
    return 0;
  }

  return matching.length;
}

/** Exponential with a ceiling: 30s, 2m, 8m, 32m, capped at an hour. */
function retryDelaySeconds(attempt: number): number {
  return Math.min(30 * 4 ** Math.max(0, attempt - 1), 3600);
}

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/**
 * Sends one batch. Called by the cron route.
 *
 * Returns counts rather than throwing on a delivery failure — a failed
 * delivery is the expected case this function exists to handle, not an error
 * in the worker.
 */
export async function deliverBatch(limit = 20): Promise<{
  claimed: number;
  delivered: number;
  failed: number;
  deadLettered: number;
}> {
  const db = supabaseAdmin();

  const { data: claimed, error } = await db.rpc('claim_webhook_deliveries', { p_limit: limit });
  if (error) throw error;

  const rows = (claimed ?? []) as DeliveryRow[];
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of rows) {
    const { data: endpoint } = await db
      .from('webhook_endpoints')
      .select('id, url, secret, consecutive_failures')
      .eq('id', row.endpoint_id)
      .maybeSingle();

    if (!endpoint) {
      await db.from('webhook_deliveries').update({ status: 'failed', error: 'endpoint removed' }).eq('id', row.id);
      failed += 1;
      continue;
    }

    // Re-validated at send time, not only at creation. An endpoint stored
    // before the guard existed, or a hostname that now resolves elsewhere,
    // must not be trusted because it once passed.
    const urlCheck = checkUrl(endpoint.url);
    if (!urlCheck.ok) {
      await db
        .from('webhook_deliveries')
        .update({ status: 'failed', error: `refused: ${urlCheck.reason}` })
        .eq('id', row.id);
      await db
        .from('webhook_endpoints')
        .update({ enabled: false, disabled_reason: `unsafe URL: ${urlCheck.reason}` })
        .eq('id', endpoint.id);
      logger.warn('webhook:unsafe_url_refused', { endpointId: endpoint.id });
      failed += 1;
      continue;
    }

    const body = JSON.stringify(row.payload);
    const signature = signPayload(body, endpoint.secret);

    let responseStatus: number | null = null;
    let responseBody = '';
    let sendError: string | null = null;

    try {
      const controller = new AbortController();
      // A slow receiver must not hold a worker slot. Ten seconds is generous
      // for something that should be acknowledging and queueing.
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-OwBrand-Signature': signature,
          'X-OwBrand-Event': row.event_type,
          // Lets a receiver deduplicate. At-least-once delivery is the only
          // honest guarantee — a response that times out after the receiver
          // committed is indistinguishable from one that never arrived — so
          // the receiver needs an idempotency handle.
          'X-OwBrand-Delivery': row.id,
          'user-agent': 'OwBrand-Webhooks/1',
        },
        body,
        signal: controller.signal,
        // No redirects: a 302 to an internal address is the classic way past a
        // URL check that only inspected the original.
        redirect: 'manual',
      });

      clearTimeout(timeout);
      responseStatus = response.status;
      responseBody = (await response.text().catch(() => '')).slice(0, 2000);
    } catch (error) {
      sendError = error instanceof Error ? error.message : String(error);
    }

    const ok = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;

    if (ok) {
      await db
        .from('webhook_deliveries')
        .update({
          status: 'delivered',
          response_status: responseStatus,
          response_body: responseBody,
          delivered_at: new Date().toISOString(),
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      // Reset on success, so a single bad day cannot accumulate toward
      // disabling an endpoint that works.
      await db.from('webhook_endpoints').update({ consecutive_failures: 0 }).eq('id', endpoint.id);
      delivered += 1;
      continue;
    }

    const exhausted = row.attempts >= row.max_attempts;

    await db
      .from('webhook_deliveries')
      .update({
        status: exhausted ? 'dead_letter' : 'pending',
        response_status: responseStatus,
        response_body: responseBody,
        error: sendError ?? `HTTP ${responseStatus}`,
        next_attempt_at: exhausted
          ? null
          : new Date(Date.now() + retryDelaySeconds(row.attempts) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    const failures = (endpoint.consecutive_failures ?? 0) + 1;
    await db
      .from('webhook_endpoints')
      .update({
        consecutive_failures: failures,
        /*
         * Disabled after 20 consecutive failures. An endpoint that has been
         * gone for days should not be retried on every event forever — that is
         * a slow outbound flood aimed at whoever now owns that address, and it
         * fills the delivery log with noise that hides real failures.
         */
        ...(failures >= 20 ? { enabled: false, disabled_reason: '20 consecutive delivery failures' } : {}),
      })
      .eq('id', endpoint.id);

    if (exhausted) deadLettered += 1;
    else failed += 1;
  }

  return { claimed: rows.length, delivered, failed, deadLettered };
}
