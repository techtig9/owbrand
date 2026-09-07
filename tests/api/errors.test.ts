import { describe, it, expect } from 'vitest';
import { ApiError, toErrorResponse, routeHandler } from '@/lib/api/errors';

/**
 * The error envelope.
 *
 * The contract under test: a client NEVER receives a stack trace, SQL text,
 * provider payload or internal identifier — while the server still logs the
 * real cause against a shared requestId.
 */
describe('ApiError', () => {
  it('maps each code to the right HTTP status', () => {
    expect(new ApiError('unauthenticated').status).toBe(401);
    expect(new ApiError('forbidden').status).toBe(403);
    expect(new ApiError('not_found').status).toBe(404);
    expect(new ApiError('invalid_request').status).toBe(400);
    expect(new ApiError('rate_limited').status).toBe(429);
    expect(new ApiError('payment_required').status).toBe(402);
    expect(new ApiError('conflict').status).toBe(409);
    expect(new ApiError('provider_unavailable').status).toBe(502);
    expect(new ApiError('not_configured').status).toBe(503);
    expect(new ApiError('internal').status).toBe(500);
  });

  it('supplies a safe default message that mentions no infrastructure', () => {
    const message = new ApiError('internal').message;
    expect(message).toBeTruthy();
    for (const leak of ['supabase', 'postgres', 'sql', 'stack', 'undefined', 'null']) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });

  it('keeps `internal` context off the instance message', () => {
    const error = ApiError.forbidden(undefined, { secretDetail: 'service_role key rejected' });
    expect(error.message).not.toContain('service_role');
  });
});

describe('toErrorResponse', () => {
  it('serialises an ApiError to the documented envelope', async () => {
    const response = toErrorResponse(ApiError.notFound('Brand not found.'));
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body).toMatchObject({ error: 'Brand not found.', code: 'not_found' });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // Nothing else may appear.
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'requestId']);
  });

  it('includes safe details when present', async () => {
    const response = toErrorResponse(
      ApiError.invalid('Some of the details you sent were not valid.', { fields: { name: ['Required'] } })
    );
    const body = await response.json();
    expect(body.details).toMatchObject({ fields: { name: ['Required'] } });
  });

  it('sets Retry-After for a rate-limit error', () => {
    const response = toErrorResponse(ApiError.rateLimited(42));
    expect(response.headers.get('Retry-After')).toBe('42');
  });

  it('NEVER leaks an unexpected error’s message or stack', async () => {
    const leaky = new Error(
      'duplicate key value violates unique constraint "subscriptions_user_id_key" DETAIL: Key (user_id)=(abc) already exists'
    );

    const response = toErrorResponse(leaky);
    expect(response.status).toBe(500);

    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain('duplicate key');
    expect(serialised).not.toContain('subscriptions_user_id_key');
    expect(serialised).not.toContain('DETAIL');
    expect(body.code).toBe('internal');
  });

  it('does not leak a thrown string or object either', async () => {
    for (const thrown of ['SUPABASE_SERVICE_ROLE_KEY=sk_live_abc', { token: 'secret' }, 42, null]) {
      const body = await toErrorResponse(thrown).json();
      expect(JSON.stringify(body)).not.toContain('sk_live_abc');
      expect(JSON.stringify(body)).not.toContain('secret');
      expect(body.code).toBe('internal');
    }
  });
});

describe('routeHandler', () => {
  it('passes a successful response through and tags it with a request id', async () => {
    const handler = routeHandler('/api/test', async () => Response.json({ ok: true }));
    const response = await handler();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('converts a thrown ApiError into its status', async () => {
    const handler = routeHandler('/api/test', async () => {
      throw ApiError.unauthenticated();
    });

    const response = await handler();
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('unauthenticated');
  });

  it('converts an unexpected throw into a safe 500', async () => {
    const handler = routeHandler('/api/test', async () => {
      throw new Error('relation "brands" does not exist');
    });

    const response = await handler();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('relation');
  });

  it('correlates the response header with the body requestId', async () => {
    const handler = routeHandler('/api/test', async () => {
      throw ApiError.notFound();
    });

    const response = await handler();
    const body = await response.json();
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('never rethrows', async () => {
    const handler = routeHandler('/api/test', async () => {
      throw new Error('boom');
    });
    await expect(handler()).resolves.toBeInstanceOf(Response);
  });
});
