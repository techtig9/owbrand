import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Rate limiting.
 *
 * Upstash is deliberately NOT configured in the test environment, so these
 * exercise the in-process fallback path — which is also the path a deployment
 * without UPSTASH_REDIS_REST_URL takes, so it needs to actually work.
 */
const { checkRateLimit, enforceRateLimit, RATE_LIMITS, isDistributed, __resetMemoryBuckets } = await import(
  '@/lib/security/rate-limit'
);
const { clientIp } = await import('@/lib/security/rate-limit');
const { ApiError } = await import('@/lib/api/errors');

beforeEach(() => {
  __resetMemoryBuckets();
  vi.useRealTimers();
});

describe('checkRateLimit', () => {
  it('allows requests up to the limit and then refuses', async () => {
    const rule = RATE_LIMITS.auth;
    const id = 'user-under-test';

    for (let i = 0; i < rule.limit; i++) {
      const result = await checkRateLimit('auth', id);
      expect(result.allowed, `request ${i + 1} of ${rule.limit} should be allowed`).toBe(true);
    }

    const overflow = await checkRateLimit('auth', id);
    expect(overflow.allowed).toBe(false);
    expect(overflow.remaining).toBe(0);
    expect(overflow.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each identifier separately', async () => {
    const rule = RATE_LIMITS.auth;
    for (let i = 0; i < rule.limit; i++) await checkRateLimit('auth', 'alice');

    expect((await checkRateLimit('auth', 'alice')).allowed).toBe(false);
    // Bob must be unaffected by Alice exhausting her budget.
    expect((await checkRateLimit('auth', 'bob')).allowed).toBe(true);
  });

  it('counts each policy separately', async () => {
    const rule = RATE_LIMITS.auth;
    for (let i = 0; i < rule.limit; i++) await checkRateLimit('auth', 'shared-id');

    expect((await checkRateLimit('auth', 'shared-id')).allowed).toBe(false);
    // A different policy has its own budget for the same subject.
    expect((await checkRateLimit('standard', 'shared-id')).allowed).toBe(true);
  });

  it('decrements the remaining count', async () => {
    const first = await checkRateLimit('standard', 'counting');
    const second = await checkRateLimit('standard', 'counting');
    expect(second.remaining).toBeLessThan(first.remaining);
  });

  it('resets after the window elapses', async () => {
    vi.useFakeTimers();
    const rule = RATE_LIMITS.auth;
    const id = 'window-test';

    for (let i = 0; i < rule.limit; i++) await checkRateLimit('auth', id);
    expect((await checkRateLimit('auth', id)).allowed).toBe(false);

    vi.advanceTimersByTime(rule.windowSeconds * 1000 + 1000);
    expect((await checkRateLimit('auth', id)).allowed).toBe(true);
  });

  it('applies a strict budget to auth and a loose one to reads', () => {
    // Guards against someone loosening the auth limit by accident: credential
    // stuffing defence depends on it staying tight.
    expect(RATE_LIMITS.auth.limit).toBeLessThanOrEqual(20);
    expect(RATE_LIMITS.standard.limit).toBeGreaterThan(RATE_LIMITS.auth.limit);
  });
});

describe('enforceRateLimit', () => {
  it('resolves silently while under the limit', async () => {
    await expect(enforceRateLimit('standard', 'enforce-ok')).resolves.toBeUndefined();
  });

  it('raises ApiError(429) with Retry-After detail once exceeded', async () => {
    const rule = RATE_LIMITS.auth;
    for (let i = 0; i < rule.limit; i++) await checkRateLimit('auth', 'enforce-fail');

    const error = await enforceRateLimit('auth', 'enforce-fail').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.code).toBe('rate_limited');
    expect(error.details?.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('isDistributed', () => {
  it('reports false when Upstash is not configured', () => {
    // The important property: we never silently claim distributed enforcement.
    // /api/ready surfaces this as `degraded` in production.
    expect(isDistributed()).toBe(false);
  });
});

describe('clientIp', () => {
  it('takes the left-most x-forwarded-for entry', () => {
    const request = new Request('https://owbrand.test', {
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' },
    });
    expect(clientIp(request)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    const request = new Request('https://owbrand.test', { headers: { 'x-real-ip': '198.51.100.4' } });
    expect(clientIp(request)).toBe('198.51.100.4');
  });

  it('returns a stable placeholder when no header is present', () => {
    expect(clientIp(new Request('https://owbrand.test'))).toBe('unknown');
  });
});
