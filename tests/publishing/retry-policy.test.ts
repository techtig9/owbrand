import { describe, it, expect } from 'vitest';
import { decideRetry, retryDelaySeconds, DEFAULT_MAX_ATTEMPTS } from '@/lib/publishing/retry-policy';

/**
 * Retry policy.
 *
 * Two failure modes to guard against: retrying something that cannot succeed
 * (which delays telling the user about a broken credential), and retrying so
 * fast that a platform rate limit is immediately tripped again.
 */

describe('decideRetry', () => {
  it('retries a transient failure', () => {
    const decision = decideRetry({ kind: 'retryable', attempt: 1, maxAttempts: 5 });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.delaySeconds).toBeGreaterThan(0);
  });

  it('never retries a credential failure', () => {
    // The user has to reconnect; five more attempts change nothing and delay
    // the message that would let them fix it.
    const decision = decideRetry({ kind: 'needs_reconnect', attempt: 1, maxAttempts: 5 });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toMatch(/reconnect/i);
  });

  it('never retries a permanent failure', () => {
    expect(decideRetry({ kind: 'permanent', attempt: 1, maxAttempts: 5 }).shouldRetry).toBe(false);
  });

  it('never retries an unavailable platform', () => {
    expect(decideRetry({ kind: 'unavailable', attempt: 1, maxAttempts: 5 }).shouldRetry).toBe(false);
  });

  it('stops at the attempt ceiling', () => {
    expect(decideRetry({ kind: 'retryable', attempt: 5, maxAttempts: 5 }).shouldRetry).toBe(false);
    expect(decideRetry({ kind: 'retryable', attempt: 4, maxAttempts: 5 }).shouldRetry).toBe(true);
  });

  it('reports the ceiling in the reason, for the attempt log', () => {
    const decision = decideRetry({ kind: 'retryable', attempt: 5, maxAttempts: 5 });
    expect(decision.reason).toMatch(/5\/5/);
  });

  it('never retries past the ceiling even if asked with a higher attempt', () => {
    expect(decideRetry({ kind: 'retryable', attempt: 99, maxAttempts: 5 }).shouldRetry).toBe(false);
  });

  it('defaults to five attempts, matching the database column', () => {
    // A mismatch here would let the worker keep trying a job the claim query
    // has already stopped returning, or give up while rows remain claimable.
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
  });
});

describe('retryDelaySeconds', () => {
  it('never returns a near-zero delay', () => {
    // Full jitter (used in the AI layer) can return ~0, which for a platform
    // rate limit means tripping it again immediately.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      for (let i = 0; i < 40; i += 1) {
        expect(retryDelaySeconds(attempt)).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('grows with the attempt number', () => {
    // Compared as medians over samples, since each call is jittered.
    const median = (attempt: number) => {
      const samples = Array.from({ length: 51 }, () => retryDelaySeconds(attempt)).sort((a, b) => a - b);
      return samples[25];
    };

    expect(median(3)).toBeGreaterThan(median(1));
    expect(median(5)).toBeGreaterThan(median(3));
  });

  it('caps the delay at six hours', () => {
    for (let i = 0; i < 40; i += 1) {
      expect(retryDelaySeconds(30)).toBeLessThanOrEqual(6 * 60 * 60);
    }
  });

  it('obeys the provider Retry-After over its own schedule', () => {
    // The platform said when to come back. Anything sooner is self-inflicted.
    expect(retryDelaySeconds(1, 3600)).toBe(3600);
    expect(retryDelaySeconds(5, 90)).toBe(90);
  });

  it('still caps a provider Retry-After', () => {
    expect(retryDelaySeconds(1, 10_000_000)).toBe(6 * 60 * 60);
  });

  it('ignores a zero or negative Retry-After', () => {
    expect(retryDelaySeconds(1, 0)).toBeGreaterThanOrEqual(60);
    expect(retryDelaySeconds(1, -5)).toBeGreaterThanOrEqual(60);
  });

  it('is jittered, so a batch that failed together does not retry in lockstep', () => {
    const values = new Set(Array.from({ length: 30 }, () => retryDelaySeconds(3)));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe('the decision carried into the database', () => {
  it('passes a delay only when retrying', () => {
    // complete_publishing_job() sets next_attempt_at from this, so a delay on
    // a terminal outcome would schedule a retry the state machine forbids.
    expect(decideRetry({ kind: 'permanent', attempt: 1, maxAttempts: 5 }).delaySeconds).toBe(0);
    expect(decideRetry({ kind: 'retryable', attempt: 5, maxAttempts: 5 }).delaySeconds).toBe(0);
  });
});
