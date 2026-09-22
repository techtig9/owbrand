import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Paddle configuration must fail LOUDLY and DISTINGUISHABLY.
 *
 * `verifyPaddleWebhook` used to read `process.env.PADDLE_WEBHOOK_SECRET!`
 * inside a `try { ... } catch { return null }`. With the variable unset,
 * unmarshal threw, the catch swallowed it, and the function returned null —
 * so the route answered "invalid signature" to every genuine Paddle event.
 *
 * It failed closed, which is correct, but it collapsed two very different
 * causes into one answer. An operator watching subscription events vanish had
 * no way to tell a forgotten environment variable from a forged request, and
 * the obvious next suspicion is that Paddle is misbehaving. Meanwhile real
 * upgrades silently never applied.
 *
 * The property under test is therefore not "it rejects" — the old code did
 * that. It is that the two causes now produce two different, correct outcomes.
 */

const KEYS = ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET', 'PADDLE_PRICE_PRO_MONTHLY'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('verifyPaddleWebhook with no secret configured', () => {
  it('throws MissingEnvError instead of returning null', async () => {
    process.env.PADDLE_API_KEY = 'pdl_test_key';
    const { verifyPaddleWebhook } = await import('@/lib/paddle');

    // Returning null here is the bug: it is the same answer a forged
    // signature produces.
    await expect(verifyPaddleWebhook('{}', 'ts=1;h1=abc')).rejects.toMatchObject({
      name: 'MissingEnvError',
    });
  });

  it('surfaces as 503 not_configured, not 401 and not 500', async () => {
    process.env.PADDLE_API_KEY = 'pdl_test_key';
    const { verifyPaddleWebhook } = await import('@/lib/paddle');
    const { toErrorResponse } = await import('@/lib/api/errors');

    let thrown: unknown;
    try {
      await verifyPaddleWebhook('{}', 'ts=1;h1=abc');
    } catch (error) {
      thrown = error;
    }

    const response = toErrorResponse(thrown);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('not_configured');
  });
});

describe('verifyPaddleWebhook with a secret but a bad signature', () => {
  /*
   * The other half of the pair, and the reason the first two tests mean
   * anything. If this returned 503 as well, the two causes would still be
   * indistinguishable — just in the opposite direction.
   */
  it('returns null so the caller can answer 401', async () => {
    process.env.PADDLE_API_KEY = 'pdl_test_key';
    process.env.PADDLE_WEBHOOK_SECRET = 'pdl_ntfset_deadbeef';
    const { verifyPaddleWebhook } = await import('@/lib/paddle');

    const result = await verifyPaddleWebhook('{"eventType":"x"}', 'ts=1;h1=not-a-real-signature');
    expect(result).toBeNull();
  });
});

describe('priceIdFor', () => {
  it('throws MissingEnvError when the price is not configured', async () => {
    const { priceIdFor } = await import('@/lib/paddle');

    // Previously a bare `new Error(...)`, which the API layer could only
    // classify as an unexpected 500.
    expect(() => priceIdFor('pro', 'monthly')).toThrowError(
      expect.objectContaining({ name: 'MissingEnvError' })
    );
  });

  it('composes the variable name from plan and cadence', async () => {
    process.env.PADDLE_PRICE_PRO_MONTHLY = 'pri_123';
    const { priceIdFor } = await import('@/lib/paddle');

    expect(priceIdFor('pro', 'monthly')).toBe('pri_123');
  });

  it('does not silently fall back to another cadence', async () => {
    process.env.PADDLE_PRICE_PRO_MONTHLY = 'pri_123';
    const { priceIdFor } = await import('@/lib/paddle');

    // Billing the wrong cadence is worse than refusing to bill.
    expect(() => priceIdFor('pro', 'yearly')).toThrowError(/PADDLE_PRICE_PRO_YEARLY/);
  });
});
