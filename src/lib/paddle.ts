import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { publicEnv, serverEnv } from '@/lib/env';
import type { PlanId } from '@/types';

/**
 * Loosely typed on purpose: the exact event-entity export name has moved
 * between @paddle/paddle-node-sdk versions. The shape used below
 * (eventType/data) matches Paddle's documented webhook payloads regardless of
 * the SDK's type name for it.
 */
export type PaddleWebhookEvent = { eventType: string; data: Record<string, unknown> };

/**
 * Every value here now comes from the validated env module.
 *
 * It previously read `process.env` directly and threw bare `Error`s, so a
 * deployment missing its billing credentials produced a generic 500 —
 * the same defect the Supabase factories had. `MissingEnvError` maps to 503
 * `not_configured`, which tells an operator what is actually wrong.
 */
function getPaddle(): Paddle {
  return new Paddle(serverEnv.paddleApiKey, {
    environment: publicEnv.paddleEnvironment === 'production' ? Environment.production : Environment.sandbox,
  });
}

/** Maps a plan/cadence pair to its configured Paddle price id. */
export function priceIdFor(plan: Exclude<PlanId, 'free'>, cadence: 'monthly' | 'yearly'): string {
  return serverEnv.paddlePriceId(plan, cadence);
}

/**
 * Verifies a Paddle webhook signature. Returns null when the signature does
 * not verify; the caller must reject the request.
 *
 * THE SECRET IS READ BEFORE THE TRY BLOCK, and that is the point.
 *
 * Previously the whole call sat inside `try { ... } catch { return null }`
 * with `process.env.PADDLE_WEBHOOK_SECRET!` inline. With the variable unset,
 * unmarshal threw, the catch swallowed it, and the function returned null —
 * so the route answered "invalid signature" to every genuine Paddle event.
 * It failed closed, which is right, but a forgotten secret and a forged
 * request became indistinguishable: an operator debugging silently-dropped
 * subscription events had nothing to go on, and the natural next guess is
 * that Paddle is at fault.
 *
 * Now a missing secret throws MissingEnvError out of this function (→ 503
 * `not_configured`) and only a real verification failure returns null (→ 401).
 * Two causes, two distinguishable answers.
 */
export async function verifyPaddleWebhook(
  rawBody: string,
  signature: string
): Promise<PaddleWebhookEvent | null> {
  const secret = serverEnv.paddleWebhookSecret;
  const paddle = getPaddle();

  try {
    const event = await paddle.webhooks.unmarshal(rawBody, secret, signature);
    return event as unknown as PaddleWebhookEvent;
  } catch {
    // Signature mismatch or malformed body. Deliberately opaque to the caller:
    // never report which of the two it was.
    return null;
  }
}

/** Cancels, pauses or resumes a subscription via Paddle's management API. */
export async function updatePaddleSubscription(
  paddleSubscriptionId: string,
  action: 'cancel' | 'pause' | 'resume'
) {
  const paddle = getPaddle();

  if (action === 'cancel') {
    return paddle.subscriptions.cancel(paddleSubscriptionId, { effectiveFrom: 'next_billing_period' });
  }
  if (action === 'pause') {
    return paddle.subscriptions.pause(paddleSubscriptionId, { effectiveFrom: 'next_billing_period' });
  }
  return paddle.subscriptions.resume(paddleSubscriptionId, { effectiveFrom: 'immediately' });
}
