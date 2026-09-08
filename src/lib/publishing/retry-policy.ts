/**
 * When to retry a publish, and how long to wait.
 *
 * Deliberately different from the AI layer's policy in `lib/ai/resilience.ts`.
 * That one retries inside a single request while a user waits, so it uses full
 * jitter over hundreds of milliseconds. Publishing retries happen across cron
 * ticks with nobody waiting, and the failures are mostly platform rate limits
 * measured in minutes or hours — so the delays are minutes, and the provider's
 * own `Retry-After` always wins when it sends one.
 */

/** Attempt 1 has already happened when a delay is computed, so index from 1. */
const BASE_DELAY_SECONDS = 60;
const MAX_DELAY_SECONDS = 6 * 60 * 60;
/** Matches `publishing_jobs.max_attempts` default. */
export const DEFAULT_MAX_ATTEMPTS = 5;

export interface RetryDecision {
  shouldRetry: boolean;
  delaySeconds: number;
  reason: string;
}

/**
 * Computes the wait before the next attempt.
 *
 * Jitter is applied as a ±25% band rather than the AI layer's full jitter:
 * full jitter can return a near-zero delay, which for a platform rate limit
 * means immediately tripping it again. A band keeps the backoff meaningful
 * while still spreading a batch of jobs that all failed at once.
 */
export function retryDelaySeconds(attempt: number, providerRetryAfter?: number): number {
  if (providerRetryAfter !== undefined && providerRetryAfter > 0) {
    // The platform told us when to come back. Anything sooner is a
    // self-inflicted rate limit.
    return Math.min(Math.round(providerRetryAfter), MAX_DELAY_SECONDS);
  }

  const exponential = BASE_DELAY_SECONDS * 2 ** Math.max(0, attempt - 1);
  const jitter = 0.75 + Math.random() * 0.5;

  // Clamp AFTER jitter, not before: capping first and then multiplying by up
  // to 1.25 lets the result exceed the ceiling the cap is meant to enforce.
  const jittered = Math.round(Math.min(exponential, MAX_DELAY_SECONDS) * jitter);

  return Math.min(Math.max(BASE_DELAY_SECONDS, jittered), MAX_DELAY_SECONDS);
}

export function decideRetry(input: {
  kind: 'retryable' | 'permanent' | 'needs_reconnect' | 'unavailable';
  attempt: number;
  maxAttempts: number;
  providerRetryAfter?: number;
}): RetryDecision {
  if (input.kind !== 'retryable') {
    // A revoked credential, a rejected caption or a platform we cannot reach
    // will fail identically next time. Retrying burns the attempt budget and
    // delays telling the user something they can actually fix.
    return {
      shouldRetry: false,
      delaySeconds: 0,
      reason: input.kind === 'needs_reconnect' ? 'credential must be reconnected' : `not retryable (${input.kind})`,
    };
  }

  if (input.attempt >= input.maxAttempts) {
    return {
      shouldRetry: false,
      delaySeconds: 0,
      reason: `attempt ceiling reached (${input.attempt}/${input.maxAttempts})`,
    };
  }

  return {
    shouldRetry: true,
    delaySeconds: retryDelaySeconds(input.attempt, input.providerRetryAfter),
    reason: 'transient failure',
  };
}
