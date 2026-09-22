import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * No route may return a 500 because configuration is missing.
 *
 * This suite exists because five routes did exactly that, and none of them was
 * caught by anything for nine phases: the OAuth callback, the Paddle webhook,
 * subscription status, the admin user list and media upload. Every environment
 * they ran in had Supabase configured, so the failing path was never taken —
 * the same reason the cron endpoints leaked in Phase 2.
 *
 * A 500 here is not a cosmetic problem. It tells an operator the application
 * is broken when the truth is that it is unconfigured, which sends them
 * debugging the wrong thing; and a 503 is the status a retrying caller (Paddle,
 * a cron scheduler, a client with backoff) treats as "come back later".
 */

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PADDLE_API_KEY',
  'PADDLE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('the Paddle webhook', () => {
  it('reports 503, not 500, when billing is unconfigured', async () => {
    const { POST } = await import('@/app/api/billing/paddle-webhook/route');

    const request = new Request('https://example.com/api/billing/paddle-webhook', {
      method: 'POST',
      headers: { 'paddle-signature': 'ts=1;h1=deadbeef' },
      body: '{}',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request as any);

    // 503 because Paddle retries it. A 500 here loses the event permanently
    // once their retry budget is spent.
    expect(response.status).toBe(503);
    expect(response.status).not.toBe(500);
  });

  it('does not name the missing variable in the response body', async () => {
    const { POST } = await import('@/app/api/billing/paddle-webhook/route');
    const request = new Request('https://example.com/api/billing/paddle-webhook', {
      method: 'POST',
      headers: { 'paddle-signature': 'x' },
      body: '{}',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await POST(request as any);
    const body = await response.text();

    // The operator gets the diagnosis from the log line and /api/ready, both
    // of which require standing. This endpoint is reachable by anyone.
    expect(body).not.toMatch(/PADDLE_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe('the OAuth callback', () => {
  it('redirects rather than throwing when Supabase is unconfigured', async () => {
    const { GET } = await import('@/app/api/social/oauth/callback/route');

    const response = await GET(
      new Request(`https://example.com/api/social/oauth/callback?state=${'f'.repeat(64)}&code=abc`)
    );

    // The route's own doc comment promises every failure redirects with a
    // generic social_error code. Before this fix it returned a raw 500.
    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('social_error=not_configured');
  });

  it('never reflects the supplied code into the redirect', async () => {
    const { GET } = await import('@/app/api/social/oauth/callback/route');
    const response = await GET(
      new Request(
        `https://example.com/api/social/oauth/callback?state=${'f'.repeat(64)}&code=SECRET-CODE`
      )
    );
    expect(response.headers.get('location') ?? '').not.toContain('SECRET-CODE');
  });
});

/*
 * The two remaining routes — subscription status and the admin user list —
 * are NOT asserted here.
 *
 * Both read the session cookie, and calling their handler directly outside a
 * request scope throws Next's own "cookies was called outside a request
 * scope" error long before any configuration is read. The assertion would
 * therefore pass or fail for a reason unrelated to what it claims to test,
 * which is worse than not having it: a green test that proves nothing is how
 * the original bug survived nine phases.
 *
 * They are covered over real HTTP in `tests/browser/smoke.js`, against a
 * server started with no environment variables set. That is the only place
 * the check means anything.
 */
