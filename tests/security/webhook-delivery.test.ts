import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { verifySignature } from '@/lib/webhooks/sign';

/**
 * The delivery worker, exercised against a REAL HTTP server.
 *
 * Mocking `fetch` here would test that the code calls fetch, which is not in
 * doubt. What is in doubt is whether the signature a receiver computes matches
 * the one we send — and that only holds if the bytes on the wire are the bytes
 * we signed. A mock cannot tell us that.
 */

interface Captured {
  body: string;
  headers: Record<string, string>;
}

let server: Server;
let baseUrl: string;
let captured: Captured[] = [];
let respondWith = { status: 200, body: 'ok' };

/** Rows the fake database hands back, and what the worker wrote to them. */
const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
let deliveries: Array<Record<string, unknown>> = [];
let endpoint: Record<string, unknown> | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async () => ({ data: deliveries, error: null }),
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        update: (values: Record<string, unknown>) => {
          updates.push({ table, values });
          return builder;
        },
        maybeSingle: async () => ({ data: endpoint, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

beforeEach(async () => {
  captured = [];
  updates.length = 0;
  respondWith = { status: 200, body: 'ok' };

  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      captured.push({ body, headers: request.headers as Record<string, string> });
      response.writeHead(respondWith.status, { 'content-type': 'text/plain' });
      response.end(respondWith.body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.resetModules();
});

function setup(url: string, secret = 'whsec_test') {
  endpoint = { id: 'e1', url, secret, consecutive_failures: 0 };
  deliveries = [
    {
      id: 'd1',
      endpoint_id: 'e1',
      event_type: 'post.published',
      payload: { event: 'post.published', data: { postId: 'p1' } },
      attempts: 1,
      max_attempts: 5,
    },
  ];
}

describe('signature interoperability', () => {
  it('sends a signature a receiver can verify from the raw body', async () => {
    // 127.0.0.1 is loopback and the URL guard blocks it, which is correct.
    // Pointing the worker at a real server therefore needs the guard stubbed
    // for this one test — the guard itself has its own suite, and what is
    // being tested here is the bytes on the wire.
    vi.doMock('@/lib/security/safe-url', () => ({ checkUrl: () => ({ ok: true }) }));
    setup(baseUrl);

    const { deliverBatch } = await import('@/lib/webhooks/deliver');
    const result = await deliverBatch(10);

    expect(result.delivered).toBe(1);
    expect(captured).toHaveLength(1);

    const signature = captured[0].headers['x-owbrand-signature'];
    expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    // The property that matters: verified against the bytes the server
    // actually received, not against what we think we sent.
    const check = verifySignature({
      body: captured[0].body,
      header: signature,
      secret: 'whsec_test',
    });
    expect(check.valid).toBe(true);
  });

  it('sends a delivery id so a receiver can deduplicate', async () => {
    vi.doMock('@/lib/security/safe-url', () => ({ checkUrl: () => ({ ok: true }) }));
    setup(baseUrl);

    const { deliverBatch } = await import('@/lib/webhooks/deliver');
    await deliverBatch(10);

    // At-least-once is the only honest guarantee, so the receiver needs a
    // handle to deduplicate on.
    expect(captured[0].headers['x-owbrand-delivery']).toBe('d1');
    expect(captured[0].headers['x-owbrand-event']).toBe('post.published');
  });
});

describe('failure handling', () => {
  it('schedules a retry on a 500 rather than giving up', async () => {
    vi.doMock('@/lib/security/safe-url', () => ({ checkUrl: () => ({ ok: true }) }));
    setup(baseUrl);
    respondWith = { status: 500, body: 'boom' };

    const { deliverBatch } = await import('@/lib/webhooks/deliver');
    const result = await deliverBatch(10);

    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);

    const delivery = updates.find((u) => u.table === 'webhook_deliveries');
    expect(delivery?.values.status).toBe('pending');
    expect(delivery?.values.next_attempt_at).toBeTruthy();
  });

  it('dead-letters once the attempt ceiling is reached', async () => {
    vi.doMock('@/lib/security/safe-url', () => ({ checkUrl: () => ({ ok: true }) }));
    setup(baseUrl);
    deliveries[0].attempts = 5;
    respondWith = { status: 500, body: 'boom' };

    const { deliverBatch } = await import('@/lib/webhooks/deliver');
    const result = await deliverBatch(10);

    expect(result.deadLettered).toBe(1);
    const delivery = updates.find((u) => u.table === 'webhook_deliveries');
    expect(delivery?.values.status).toBe('dead_letter');
    // No next attempt on a dead letter, or the worker would pick it up forever.
    expect(delivery?.values.next_attempt_at).toBeNull();
  });

  it('counts consecutive failures against the endpoint', async () => {
    vi.doMock('@/lib/security/safe-url', () => ({ checkUrl: () => ({ ok: true }) }));
    setup(baseUrl);
    respondWith = { status: 503, body: 'down' };

    const { deliverBatch } = await import('@/lib/webhooks/deliver');
    await deliverBatch(10);

    const endpointUpdate = updates.find((u) => u.table === 'webhook_endpoints');
    expect(endpointUpdate?.values.consecutive_failures).toBe(1);
    // Not disabled after one failure — that would take an endpoint out over a
    // single deploy blip.
    expect(endpointUpdate?.values.enabled).toBeUndefined();
  });

  it('disables an endpoint after 20 consecutive failures', async () => {
    vi.doMock('@/lib/security/safe-url', () => ({ checkUrl: () => ({ ok: true }) }));
    setup(baseUrl);
    endpoint = { id: 'e1', url: baseUrl, secret: 'whsec_test', consecutive_failures: 19 };
    respondWith = { status: 503, body: 'down' };

    const { deliverBatch } = await import('@/lib/webhooks/deliver');
    await deliverBatch(10);

    const endpointUpdate = updates.find((u) => u.table === 'webhook_endpoints');
    expect(endpointUpdate?.values.enabled).toBe(false);
    expect(endpointUpdate?.values.disabled_reason).toMatch(/20 consecutive/);
  });

  it('resets the failure count on a success', async () => {
    vi.doMock('@/lib/security/safe-url', () => ({ checkUrl: () => ({ ok: true }) }));
    setup(baseUrl);
    endpoint = { id: 'e1', url: baseUrl, secret: 'whsec_test', consecutive_failures: 12 };

    const { deliverBatch } = await import('@/lib/webhooks/deliver');
    await deliverBatch(10);

    const endpointUpdate = updates.find((u) => u.table === 'webhook_endpoints');
    // A single bad day must not accumulate toward disabling an endpoint that
    // works.
    expect(endpointUpdate?.values.consecutive_failures).toBe(0);
  });
});

describe('the URL guard at send time', () => {
  it('refuses a private address and disables the endpoint', async () => {
    /*
     * The real guard, explicitly un-stubbed.
     *
     * `vi.doMock` registrations survive `resetModules`, so without this the
     * stub from the tests above was still in place and the worker sailed past
     * the guard, failed to connect to 169.254.169.254, and took the ordinary
     * failure path — which looks like a pass on `result.failed` and proves
     * nothing about the guard. The first version of this test did exactly
     * that.
     */
    vi.doUnmock('@/lib/security/safe-url');
    vi.resetModules();
    setup('http://169.254.169.254/latest/meta-data/');

    const { deliverBatch } = await import('@/lib/webhooks/deliver');
    const result = await deliverBatch(10);

    expect(result.failed).toBe(1);
    expect(captured).toHaveLength(0);

    const endpointUpdate = updates.find((u) => u.table === 'webhook_endpoints');
    expect(endpointUpdate?.values.enabled).toBe(false);
  });
});
