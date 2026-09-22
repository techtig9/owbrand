import { describe, it, expect } from 'vitest';
import { classifyMetaError, classifyTransportError, PublishError } from '@/lib/social/errors';

/**
 * Provider error classification.
 *
 * This is the highest-leverage logic in the publishing path, because getting
 * it wrong is silently expensive in both directions:
 *
 *   - a rate limit misread as permanent throws away a scheduled post;
 *   - a revoked token misread as retryable burns five attempts over an hour
 *     and then reports something the user cannot act on, instead of
 *     "reconnect your account".
 *
 * Meta returns HTTP 400 for most credential failures, so status alone cannot
 * decide. Every case below is one Meta actually produces.
 */

function metaBody(code: number, subcode?: number, extra: Record<string, unknown> = {}) {
  return { error: { code, error_subcode: subcode, message: 'something went wrong', ...extra } };
}

describe('classifyMetaError — credential failures', () => {
  it('treats an expired token (code 190) as needs_reconnect, not a retry', () => {
    const error = classifyMetaError(400, metaBody(190));
    expect(error.kind).toBe('needs_reconnect');
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/reconnect/i);
  });

  it('treats a revoked-permission subcode as needs_reconnect', () => {
    // 458 = user has not authorised the application.
    expect(classifyMetaError(400, metaBody(102, 458)).kind).toBe('needs_reconnect');
  });

  it('treats a missing permission (code 200) as needs_reconnect', () => {
    const error = classifyMetaError(403, metaBody(200));
    expect(error.kind).toBe('needs_reconnect');
    expect(error.message).toMatch(/permission/i);
  });

  it('treats a bare 401 as needs_reconnect', () => {
    expect(classifyMetaError(401, null).kind).toBe('needs_reconnect');
  });
});

describe('classifyMetaError — throttling', () => {
  it('treats an application rate limit (code 4) as retryable', () => {
    const error = classifyMetaError(400, metaBody(4));
    expect(error.kind).toBe('retryable');
    expect(error.retryable).toBe(true);
  });

  it('waits far longer than a generic backoff for a Meta throttle', () => {
    // Meta's limits reset over hours; retrying in a minute just trips it again.
    const error = classifyMetaError(400, metaBody(4));
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(900);
  });

  it('prefers the provider Retry-After header over the default', () => {
    const error = classifyMetaError(429, metaBody(4), '120');
    expect(error.retryAfterSeconds).toBe(120);
  });

  it('parses an HTTP-date Retry-After', () => {
    const future = new Date(Date.now() + 300_000).toUTCString();
    const error = classifyMetaError(429, null, future);
    // Allow a second of slack for the clock between the two calls.
    expect(error.retryAfterSeconds).toBeGreaterThan(280);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(300);
  });

  it('ignores a nonsense Retry-After rather than throwing', () => {
    const error = classifyMetaError(429, null, 'soon-ish');
    expect(error.kind).toBe('retryable');
    expect(error.retryAfterSeconds).toBe(900);
  });

  it('caps an absurd Retry-After at a day', () => {
    const error = classifyMetaError(429, null, '9999999');
    expect(error.retryAfterSeconds).toBe(86_400);
  });

  it('treats a page-level rate limit (code 32) as retryable', () => {
    expect(classifyMetaError(400, metaBody(32)).kind).toBe('retryable');
  });
});

describe('classifyMetaError — transient vs permanent', () => {
  it('treats a 500 as retryable', () => {
    expect(classifyMetaError(500, null).kind).toBe('retryable');
  });

  it('treats a 503 as retryable', () => {
    expect(classifyMetaError(503, null).kind).toBe('retryable');
  });

  it('treats Meta code 2 (transient) as retryable', () => {
    expect(classifyMetaError(500, metaBody(2)).kind).toBe('retryable');
  });

  it('treats an unrecognised 400 as permanent', () => {
    // Rejected media, bad aspect ratio, unsupported caption — all fail
    // identically on a retry.
    const error = classifyMetaError(400, metaBody(1_000_000));
    expect(error.kind).toBe('permanent');
    expect(error.retryable).toBe(false);
  });

  it('treats a 404 as permanent', () => {
    expect(classifyMetaError(404, null).kind).toBe('permanent');
  });
});

describe('classifyMetaError — messages and payloads', () => {
  it('prefers error_user_msg, which Meta writes for end users', () => {
    const error = classifyMetaError(
      400,
      metaBody(1_000_001, undefined, {
        message: 'Invalid parameter: media_type',
        error_user_msg: 'This video is too long for a Reel.',
      })
    );
    expect(error.message).toContain('This video is too long for a Reel.');
    expect(error.message).not.toContain('media_type');
  });

  it('keeps the trace id for support, and no token', () => {
    const error = classifyMetaError(400, metaBody(190, undefined, { fbtrace_id: 'AbCdEf123' }));
    expect(error.providerResponse?.fbtrace_id).toBe('AbCdEf123');
    expect(JSON.stringify(error.providerResponse)).not.toMatch(/access_token|EAAG/);
  });

  it('survives a body with no error object at all', () => {
    const error = classifyMetaError(502, {});
    expect(error).toBeInstanceOf(PublishError);
    expect(error.kind).toBe('retryable');
  });
});

describe('classifyTransportError', () => {
  it('classifies an abort as a retryable timeout', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const error = classifyTransportError(abort);
    expect(error.kind).toBe('retryable');
    expect(error.code).toBe('timeout');
  });

  it('classifies a socket failure as retryable', () => {
    const error = classifyTransportError(new Error('ECONNRESET'));
    expect(error.kind).toBe('retryable');
    expect(error.code).toBe('network_error');
  });

  it('handles a non-Error throw', () => {
    expect(classifyTransportError('boom').kind).toBe('retryable');
  });
});

describe('PublishError', () => {
  it('only reports retryable for the retryable kind', () => {
    expect(new PublishError('retryable', 'c', 'm').retryable).toBe(true);
    for (const kind of ['permanent', 'needs_reconnect', 'unavailable'] as const) {
      expect(new PublishError(kind, 'c', 'm').retryable).toBe(false);
    }
  });
});
