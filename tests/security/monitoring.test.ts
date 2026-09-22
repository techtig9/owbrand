import { describe, expect, it } from 'vitest';
import { fingerprint } from '@/lib/monitoring';

/**
 * The fingerprint is the part worth testing. If it varies with the message,
 * every occurrence becomes its own issue and the tracker is unreadable within
 * a week — which is the single most common way error monitoring fails in
 * practice, and it fails quietly.
 */

function throwFrom(message: string): Error {
  try {
    throw new Error(message);
  } catch (error) {
    return error as Error;
  }
}

describe('fingerprinting', () => {
  it('groups two errors that differ only in their message', () => {
    const a = throwFrom('Brand 9f2c1a not found');
    const b = throwFrom('Brand 3e8b7d not found');
    expect(fingerprint(a, '/api/brands')).toBe(fingerprint(b, '/api/brands'));
  });

  it('separates different routes', () => {
    const error = throwFrom('boom');
    expect(fingerprint(error, '/api/brands')).not.toBe(fingerprint(error, '/api/posts'));
  });

  it('separates different error types', () => {
    class NotFound extends Error {}
    expect(fingerprint(new NotFound('x'), '/r')).not.toBe(fingerprint(new TypeError('x'), '/r'));
  });

  it('includes no line or column number', () => {
    // They change with every build, which would split one issue into a new one
    // on each deploy.
    expect(fingerprint(throwFrom('boom'), '/api/x')).not.toMatch(/:\d+:\d+/);
  });

  it('includes no absolute path', () => {
    expect(fingerprint(throwFrom('boom'), '/api/x')).not.toMatch(/\/home\/|\/Users\//);
  });

  it('handles a thrown non-Error without crashing', () => {
    expect(() => fingerprint('just a string', '/r')).not.toThrow();
    expect(() => fingerprint(undefined, '/r')).not.toThrow();
  });
});
