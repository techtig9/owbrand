import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseJsonBody, parseSearchParams, validate, boundedText, uuidSchema } from '@/lib/api/validate';
import { ApiError } from '@/lib/api/errors';

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://owbrand.test/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const Schema = z.object({ name: boundedText(1, 20), count: z.number().int().optional() });

describe('parseJsonBody', () => {
  it('parses and validates a well-formed body', async () => {
    await expect(parseJsonBody(jsonRequest({ name: 'ok', count: 2 }), Schema)).resolves.toEqual({
      name: 'ok',
      count: 2,
    });
  });

  it('rejects a non-JSON content type', async () => {
    const request = new Request('https://owbrand.test/api/x', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"name":"x"}',
    });
    await expect(parseJsonBody(request, Schema)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed JSON without leaking the parser error', async () => {
    const error = await parseJsonBody(jsonRequest('{not json'), Schema).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('Request body is not valid JSON.');
    expect(error.message).not.toContain('Unexpected token');
  });

  it('rejects an oversized body by declared content-length', async () => {
    const request = jsonRequest({ name: 'x' }, { 'content-length': '5000000' });
    await expect(parseJsonBody(request, Schema)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an oversized body even when content-length lies', async () => {
    // A truthful content-length is not guaranteed, so the actual payload is
    // measured too.
    const huge = JSON.stringify({ name: 'x'.repeat(2_000_000) });
    const request = new Request('https://owbrand.test/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: huge,
    });
    await expect(parseJsonBody(request, Schema)).rejects.toMatchObject({ status: 400 });
  });

  it('returns field-level detail that describes only what the caller sent', async () => {
    const error = await parseJsonBody(jsonRequest({ name: '' }), Schema).catch((e) => e);
    expect(error.status).toBe(400);
    expect(error.details?.fields).toHaveProperty('name');
  });
});

describe('validate', () => {
  it('accepts valid data', () => {
    expect(validate(Schema, { name: 'fine' })).toEqual({ name: 'fine' });
  });

  it('raises ApiError(400) on invalid data', () => {
    expect(() => validate(Schema, { name: 'x'.repeat(50) })).toThrowError(ApiError);
  });
});

describe('boundedText', () => {
  it('trims before applying length bounds', () => {
    const schema = boundedText(1, 5);
    expect(schema.parse('  hi  ')).toBe('hi');
  });

  it('rejects whitespace-only input for a min of 1', () => {
    expect(() => boundedText(1, 5).parse('   ')).toThrow();
  });

  it('rejects input that exceeds the maximum after trimming', () => {
    expect(() => boundedText(1, 3).parse('  abcd  ')).toThrow();
  });
});

describe('uuidSchema', () => {
  it('accepts a real uuid', () => {
    expect(uuidSchema.parse('11111111-1111-1111-1111-111111111111')).toBeTruthy();
  });

  it('rejects near-misses that an id-guessing caller might try', () => {
    for (const bad of ['', 'abc', '1111', '11111111-1111-1111-1111-11111111111', 'not-a-uuid']) {
      expect(() => uuidSchema.parse(bad), `should reject ${JSON.stringify(bad)}`).toThrow();
    }
  });
});

describe('parseSearchParams', () => {
  it('validates query parameters', () => {
    const request = new Request(
      'https://owbrand.test/api/x?brandId=11111111-1111-1111-1111-111111111111'
    );
    expect(parseSearchParams(request, z.object({ brandId: uuidSchema }))).toEqual({
      brandId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('rejects a missing required parameter', () => {
    const request = new Request('https://owbrand.test/api/x');
    expect(() => parseSearchParams(request, z.object({ brandId: uuidSchema }))).toThrowError(ApiError);
  });

  it('rejects a malformed id rather than passing it to the database', () => {
    // The old routes did `.eq('brand_id', id || '')`, which sent junk straight
    // to Postgres.
    const request = new Request('https://owbrand.test/api/x?brandId=%27%20OR%201%3D1--');
    expect(() => parseSearchParams(request, z.object({ brandId: uuidSchema }))).toThrowError(ApiError);
  });
});
