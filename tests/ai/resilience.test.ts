import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIProviderError, type AIGenerateRequest, type AIProvider } from '@/lib/ai/types';
import { generateWithFailover, backoffDelayMs, DEFAULT_RETRY_POLICY } from '@/lib/ai/resilience';
import { __resetProviderHealth, isProviderTripped, providerHealthReport } from '@/lib/ai/registry';

/**
 * Retry, backoff and failover.
 *
 * Every provider here is a fake, so these tests never make a network call and
 * never need a real API key. What they exercise is the policy: which failures
 * are retried, which fail over, and which stop immediately.
 */

const request: AIGenerateRequest = {
  task: 'content_generation',
  system: 'system',
  messages: [{ role: 'user', content: 'hello' }],
};

/** Builds a provider whose behaviour is scripted per call. */
function fakeProvider(
  id: string,
  script: Array<'ok' | 'refuse' | AIProviderError>
): AIProvider & { calls: number } {
  let calls = 0;

  const provider = {
    id,
    displayName: id,
    calls: 0,
    isConfigured: () => true,
    supportsVision: () => true,
    supportsStructuredOutput: () => true,
    modelFor: () => `${id}-model`,
    estimateCostUsd: () => 0.01,
    async generate() {
      const step = script[Math.min(calls, script.length - 1)];
      calls += 1;
      provider.calls = calls;

      if (step === 'ok') {
        return {
          text: `response from ${id}`,
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: id,
          model: `${id}-model`,
          latencyMs: 5,
        };
      }
      if (step === 'refuse') {
        return {
          text: '',
          usage: { inputTokens: 10, outputTokens: 0 },
          provider: id,
          model: `${id}-model`,
          latencyMs: 5,
          refused: true,
          refusalCategory: 'test_category',
        };
      }
      throw step;
    },
  };

  return provider as AIProvider & { calls: number };
}

// Backoff sleeps for real otherwise; policy with 0 delay keeps tests fast.
const fastPolicy = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 0, maxDelayMs: 0, maxRetryAfterMs: 0 };

beforeEach(() => {
  __resetProviderHealth();
});

describe('backoffDelayMs', () => {
  it('grows exponentially and is capped', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 100, maxDelayMs: 1000 };
    // Full jitter means the value is in [0, exponential), so assert the bound.
    for (let attempt = 1; attempt <= 6; attempt++) {
      const delay = backoffDelayMs(attempt, policy);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(policy.maxDelayMs);
    }
  });

  it('uses FULL jitter, not a fixed delay', () => {
    // Fixed backoff would make every request that failed during an outage
    // retry in lockstep and re-create the thundering herd.
    const policy = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 1000, maxDelayMs: 8000 };
    const samples = new Set(Array.from({ length: 40 }, () => backoffDelayMs(3, policy)));
    expect(samples.size).toBeGreaterThan(5);
  });
});

describe('generateWithFailover — success', () => {
  it('returns the first provider’s result', async () => {
    const primary = fakeProvider('primary', ['ok']);
    const result = await generateWithFailover(request, { providers: [primary], policy: fastPolicy });

    expect(result.text).toBe('response from primary');
    expect(result.viaFallback).toBe(false);
    expect(primary.calls).toBe(1);
  });

  it('does not call the fallback when the primary succeeds', async () => {
    const primary = fakeProvider('primary', ['ok']);
    const fallback = fakeProvider('fallback', ['ok']);

    await generateWithFailover(request, { providers: [primary, fallback], policy: fastPolicy });
    expect(fallback.calls).toBe(0);
  });
});

describe('generateWithFailover — retry', () => {
  it('retries a rate limit and then succeeds', async () => {
    const provider = fakeProvider('p', [
      new AIProviderError('rate_limited', 'p', 'slow down'),
      'ok',
    ]);

    const result = await generateWithFailover(request, { providers: [provider], policy: fastPolicy });
    expect(result.text).toBe('response from p');
    expect(provider.calls).toBe(2);
    expect(result.attempts.map((a) => a.outcome)).toEqual(['retryable_error', 'success']);
  });

  it('retries a timeout', async () => {
    const provider = fakeProvider('p', [new AIProviderError('timeout', 'p', 'too slow'), 'ok']);
    await expect(
      generateWithFailover(request, { providers: [provider], policy: fastPolicy })
    ).resolves.toMatchObject({ text: 'response from p' });
  });

  it('retries an overloaded provider', async () => {
    const provider = fakeProvider('p', [new AIProviderError('overloaded', 'p', '529'), 'ok']);
    await expect(
      generateWithFailover(request, { providers: [provider], policy: fastPolicy })
    ).resolves.toBeTruthy();
  });

  it('stops after the attempt budget', async () => {
    const provider = fakeProvider('p', [new AIProviderError('rate_limited', 'p', 'nope')]);
    const policy = { ...fastPolicy, maxAttemptsPerProvider: 3 };

    await expect(generateWithFailover(request, { providers: [provider], policy })).rejects.toBeInstanceOf(
      AIProviderError
    );
    expect(provider.calls).toBe(3);
  });

  it('does NOT retry an invalid request — it would fail identically', async () => {
    const provider = fakeProvider('p', [new AIProviderError('invalid_request', 'p', 'bad schema')]);

    await expect(
      generateWithFailover(request, { providers: [provider], policy: fastPolicy })
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(provider.calls).toBe(1);
  });
});

describe('generateWithFailover — failover', () => {
  it('moves to the fallback when the primary is exhausted', async () => {
    const primary = fakeProvider('primary', [new AIProviderError('overloaded', 'primary', 'down')]);
    const fallback = fakeProvider('fallback', ['ok']);

    const result = await generateWithFailover(request, {
      providers: [primary, fallback],
      policy: { ...fastPolicy, maxAttemptsPerProvider: 2 },
    });

    expect(result.text).toBe('response from fallback');
    expect(result.viaFallback).toBe(true);
    expect(primary.calls).toBe(2);
    expect(fallback.calls).toBe(1);
  });

  it('does NOT fail over on an invalid request', async () => {
    const primary = fakeProvider('primary', [new AIProviderError('invalid_request', 'primary', 'our bug')]);
    const fallback = fakeProvider('fallback', ['ok']);

    await expect(
      generateWithFailover(request, { providers: [primary, fallback], policy: fastPolicy })
    ).rejects.toMatchObject({ kind: 'invalid_request' });

    // Our own malformed request would be rejected by every provider.
    expect(fallback.calls).toBe(0);
  });

  it('does NOT fail over on a content filter', async () => {
    const primary = fakeProvider('primary', [new AIProviderError('content_filtered', 'primary', 'blocked')]);
    const fallback = fakeProvider('fallback', ['ok']);

    await expect(
      generateWithFailover(request, { providers: [primary, fallback], policy: fastPolicy })
    ).rejects.toMatchObject({ kind: 'content_filtered' });
    expect(fallback.calls).toBe(0);
  });

  it('throws when every provider fails', async () => {
    const a = fakeProvider('a', [new AIProviderError('overloaded', 'a', 'down')]);
    const b = fakeProvider('b', [new AIProviderError('connection', 'b', 'unreachable')]);

    await expect(
      generateWithFailover(request, { providers: [a, b], policy: { ...fastPolicy, maxAttemptsPerProvider: 1 } })
    ).rejects.toBeInstanceOf(AIProviderError);
  });

  it('raises not_configured when the chain is empty', async () => {
    await expect(
      generateWithFailover(request, { providers: [], policy: fastPolicy })
    ).rejects.toMatchObject({ kind: 'not_configured' });
  });
});

describe('generateWithFailover — refusals', () => {
  it('tries the next provider, whose policy may differ', async () => {
    const primary = fakeProvider('primary', ['refuse']);
    const fallback = fakeProvider('fallback', ['ok']);

    const result = await generateWithFailover(request, {
      providers: [primary, fallback],
      policy: fastPolicy,
    });

    expect(result.text).toBe('response from fallback');
    // Refused once, not retried on the same provider.
    expect(primary.calls).toBe(1);
  });

  it('returns the refusal when it is the last provider', async () => {
    const provider = fakeProvider('only', ['refuse']);
    const result = await generateWithFailover(request, { providers: [provider], policy: fastPolicy });

    expect(result.refused).toBe(true);
    expect(result.refusalCategory).toBe('test_category');
    expect(provider.calls).toBe(1);
  });

  it('does not count a refusal against provider health', async () => {
    const provider = fakeProvider('only', ['refuse']);
    await generateWithFailover(request, { providers: [provider], policy: fastPolicy });

    // A refusal is a decision, not an outage.
    expect(isProviderTripped('only')).toBe(false);
  });
});

describe('circuit breaker', () => {
  it('trips a provider after repeated failures', async () => {
    const provider = fakeProvider('flaky', [new AIProviderError('overloaded', 'flaky', 'down')]);

    await expect(
      generateWithFailover(request, {
        providers: [provider],
        policy: { ...fastPolicy, maxAttemptsPerProvider: 3 },
      })
    ).rejects.toBeTruthy();

    expect(isProviderTripped('flaky')).toBe(true);
  });

  it('does not trip on our own invalid request', async () => {
    const provider = fakeProvider('p', [new AIProviderError('invalid_request', 'p', 'bad')]);

    for (let i = 0; i < 5; i++) {
      await generateWithFailover(request, { providers: [provider], policy: fastPolicy }).catch(() => {});
    }

    expect(isProviderTripped('p')).toBe(false);
  });

  it('resets on a success', async () => {
    const provider = fakeProvider('p', [
      new AIProviderError('overloaded', 'p', 'down'),
      new AIProviderError('overloaded', 'p', 'down'),
      'ok',
    ]);

    await generateWithFailover(request, {
      providers: [provider],
      policy: { ...fastPolicy, maxAttemptsPerProvider: 3 },
    });

    expect(isProviderTripped('p')).toBe(false);
  });
});

describe('providerHealthReport', () => {
  it('reports configured state honestly', () => {
    // Neither key is set in the test environment, so nothing may claim to be
    // configured — the master command forbids reporting an unavailable
    // provider as available.
    const report = providerHealthReport();
    expect(report.length).toBeGreaterThan(0);
    for (const entry of report) {
      expect(entry.configured).toBe(false);
    }
  });
});
