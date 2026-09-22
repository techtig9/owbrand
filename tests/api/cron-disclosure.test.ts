import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cron endpoints must not tell an anonymous caller anything.
 *
 * All three previously answered an unconfigured deployment with
 *
 *   503 {"error":"The publishing worker trigger is not configured.
 *                 Set CRON_SECRET.","code":"not_configured"}
 *
 * to any request at all. That confirms the path exists, identifies it as a
 * publishing trigger, and tells a stranger both that the deployment is
 * misconfigured and which variable is missing. The browser suite caught it
 * against a real server, and the assertion it broke states the reason:
 * "a 401 would confirm the endpoint exists and takes a secret."
 *
 * Be-honest-about-misconfiguration is right almost everywhere in this codebase
 * — it is why a missing Supabase URL is a 503 `not_configured` rather than an
 * opaque 500. The difference here is WHO is asking. A Paddle webhook is called
 * by Paddle and diagnosed from the operator's own logs. This route is reachable
 * by anyone holding nothing.
 *
 * These tests exist because the leak is invisible in the happy path: with
 * CRON_SECRET set, every one of them passes either way. Only an unconfigured
 * deployment shows it, which is exactly the deployment nobody tests.
 */

const ROUTES = [
  { path: 'publish', module: '@/app/api/cron/publish/route' },
  { path: 'social-health', module: '@/app/api/cron/social-health/route' },
  { path: 'analytics', module: '@/app/api/cron/analytics/route' },
] as const;

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  vi.resetModules();
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe.each(ROUTES)('/api/cron/$path with CRON_SECRET unset', ({ path, module }) => {
  it('answers 404, not 503', async () => {
    const { GET } = await import(module);
    const response = await GET(new Request(`https://example.test/api/cron/${path}`));

    expect(response.status).toBe(404);
  });

  it('does not name the feature, the variable, or the misconfiguration', async () => {
    const { GET } = await import(module);
    const response = await GET(new Request(`https://example.test/api/cron/${path}`));
    const body = JSON.stringify(await response.json());

    expect(body).not.toMatch(/CRON_SECRET/i);
    expect(body).not.toMatch(/not_configured/i);
    expect(body).not.toMatch(/publishing|worker|trigger|ingestion|health job/i);
    // The only acceptable answer is the one a nonexistent path gives.
    expect(body).toBe(JSON.stringify({ error: 'Not found.' }));
  });

  it('answers identically to a wrong secret, so the two are indistinguishable', async () => {
    const { GET } = await import(module);

    const unconfigured = await GET(new Request(`https://example.test/api/cron/${path}`));
    const unconfiguredBody = await unconfigured.text();

    process.env.CRON_SECRET = 'the-real-secret';
    vi.resetModules();
    const { GET: GET2 } = await import(module);
    const wrongSecret = await GET2(
      new Request(`https://example.test/api/cron/${path}`, {
        headers: { authorization: 'Bearer definitely-not-the-secret' },
      })
    );

    expect(wrongSecret.status).toBe(unconfigured.status);
    expect(await wrongSecret.text()).toBe(unconfiguredBody);
  });

  it('rejects POST the same way, not just GET', async () => {
    const { POST } = await import(module);
    const response = await POST(
      new Request(`https://example.test/api/cron/${path}`, { method: 'POST' })
    );

    // Both verbs are exposed so any scheduler can drive these; a fix applied
    // to one handler and not the other leaves the leak reachable.
    expect(response.status).toBe(404);
  });
});
