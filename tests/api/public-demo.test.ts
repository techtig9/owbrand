import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The public demo is the only route that spends provider money with no account
 * behind it. These tests are about the two ways it refuses.
 *
 * The one that matters most is the second: **it refuses when rate limiting is
 * not distributed.** Without Upstash, limits are per process, and a serverless
 * platform hands an attacker a fresh bucket per instance — so a per-process
 * limit on a paid, unauthenticated endpoint is not a weak control, it is the
 * appearance of one. The tempting version of this route ships anyway and
 * "relies on" the limit. This one declines to be offered.
 *
 * `vi.resetModules()` per test because both guards read environment state at
 * module scope through `isConfigured` / `isDistributed`.
 */

const KEYS = [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function demoRequest(description = 'A small-batch ceramics studio selling tableware to restaurants.') {
  return new Request('https://example.test/api/public/demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

describe('GET /api/public/demo', () => {
  it('reports unavailable with a reason when no provider is configured', async () => {
    const { GET } = await import('@/app/api/public/demo/route');
    const body = await (await GET(new Request('https://example.test/api/public/demo'))).json();

    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/no ai provider/i);
  });

  it('reports unavailable when a provider exists but rate limiting is per-process', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const { GET } = await import('@/app/api/public/demo/route');
    const body = await (await GET(new Request('https://example.test/api/public/demo'))).json();

    // The whole point: a configured provider is NOT sufficient.
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/distributed rate limiting|upstash/i);
  });

  it('reports available only when both conditions hold', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-token';

    const { GET } = await import('@/app/api/public/demo/route');
    const body = await (await GET(new Request('https://example.test/api/public/demo'))).json();

    // A positive control: without this, a GET hard-coded to
    // {available:false} would satisfy both tests above.
    expect(body.available).toBe(true);
    expect(body.reason).toBeNull();
  });
});

describe('POST /api/public/demo', () => {
  it('refuses with 503 when no provider is configured', async () => {
    const { POST } = await import('@/app/api/public/demo/route');
    const response = await POST(demoRequest());

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('not_configured');
  });

  it('refuses with 503 when rate limiting is only per-process', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const { POST } = await import('@/app/api/public/demo/route');
    const response = await POST(demoRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe('not_configured');
    expect(body.error).toMatch(/distributed rate limiting|upstash/i);
  });

  /*
   * 503 here and 404 on the cron routes, deliberately. The landing page links
   * to this endpoint, so a caller needs to distinguish "try later" from "wrong
   * URL"; nothing links to /api/cron/publish, and naming it would tell a
   * stranger a publishing trigger exists.
   */
  it('is discoverable, unlike the cron endpoints', async () => {
    const { POST } = await import('@/app/api/public/demo/route');
    const response = await POST(demoRequest());

    expect(response.status).not.toBe(404);
  });
});
