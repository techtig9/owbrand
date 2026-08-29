import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import type { PlanId } from '@/types';

/**
 * Loosely typed on purpose: the exact event-entity export name has moved
 * between @paddle/paddle-node-sdk versions. Check the installed version's
 * types (or console.log the unmarshalled event once) and tighten this if
 * you want full type safety — the shape used below (eventType/data) matches
 * Paddle's documented webhook payloads regardless of the SDK's type name.
 */
export type PaddleWebhookEvent = { eventType: string; data: Record<string, any> };

function getPaddle(): Paddle {
  if (!process.env.PADDLE_API_KEY) throw new Error('PADDLE_API_KEY is not set.');
  return new Paddle(process.env.PADDLE_API_KEY, {
    environment: process.env.NEXT_PUBLIC_PADDLE_ENV === 'production' ? Environment.production : Environment.sandbox,
  });
}

/** Maps our plan/cadence pair to the Paddle price ID configured in .env. */
export function priceIdFor(plan: Exclude<PlanId, 'free'>, cadence: 'monthly' | 'yearly'): string {
  const key = `PADDLE_PRICE_${plan.toUpperCase()}_${cadence.toUpperCase()}`;
  const priceId = process.env[key];
  if (!priceId) throw new Error(`Missing env var ${key} — create the price in Paddle first.`);
  return priceId;
}

/** Verifies the Paddle webhook signature. Reject the request if this returns null. */
export async function verifyPaddleWebhook(rawBody: string, signature: string): Promise<PaddleWebhookEvent | null> {
  const paddle = getPaddle();
  try {
    const event = await paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET!, signature);
    return event as unknown as PaddleWebhookEvent;
  } catch {
    return null;
  }
}

/** Cancels/updates a subscription via Paddle's subscription-management API. */
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
