import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * API key authentication.
 *
 * The tests that matter are about what a rejection reveals. A 401 that
 * distinguishes "no such key" from "revoked" from "expired" tells someone
 * guessing keys which guess was once real, and tells a scraper which stolen
 * keys are worth retrying after a renewal.
 */

let row: Record<string, unknown> | null = null;
const inserted: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        insert: (values: Record<string, unknown>) => {
          inserted.push(values);
          return builder;
        },
        update: () => builder,
        maybeSingle: async () => ({ data: row, error: null }),
        single: async () => ({ data: { id: 'k1', key_prefix: 'owb_live_AAAA' }, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: row, error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

function request(header?: string): Request {
  return new Request('https://example.com/api/v1/brands', {
    headers: header ? { authorization: header } : {},
  });
}

const KEY = 'owb_live_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    user_id: 'u1',
    key_hash: createHash('sha256').update(KEY).digest('hex'),
    scopes: ['read'],
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  row = null;
  inserted.length = 0;
  vi.resetModules();
});

describe('authentication', () => {
  it('resolves a valid key to a principal', async () => {
    row = validRow();
    const { authenticateApiKey } = await import('@/lib/api/v1/keys');
    const principal = await authenticateApiKey(request(`Bearer ${KEY}`));
    expect(principal).toMatchObject({ keyId: 'k1', userId: 'u1', scopes: ['read'] });
  });

  it.each([
    ['no header', undefined],
    ['wrong scheme', `Basic ${KEY}`],
    ['no prefix', 'Bearer abc123'],
    ['empty bearer', 'Bearer '],
  ])('rejects %s', async (_label, header) => {
    const { authenticateApiKey } = await import('@/lib/api/v1/keys');
    await expect(authenticateApiKey(request(header))).rejects.toThrow();
  });

  it('gives the SAME message for unknown, revoked and expired keys', async () => {
    const { authenticateApiKey } = await import('@/lib/api/v1/keys');
    const messages: string[] = [];

    for (const state of [
      null,
      validRow({ revoked_at: new Date().toISOString() }),
      validRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    ]) {
      row = state;
      try {
        await authenticateApiKey(request(`Bearer ${KEY}`));
        messages.push('ACCEPTED');
      } catch (error) {
        messages.push((error as Error).message);
      }
    }

    // All three rejected, and indistinguishable.
    expect(messages).not.toContain('ACCEPTED');
    expect(new Set(messages).size).toBe(1);
  });

  it('accepts a key whose expiry is in the future', async () => {
    // A positive control. Without it, a verifier that rejected every key would
    // pass the test above.
    row = validRow({ expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    const { authenticateApiKey } = await import('@/lib/api/v1/keys');
    await expect(authenticateApiKey(request(`Bearer ${KEY}`))).resolves.toBeTruthy();
  });
});

describe('scopes', () => {
  it('allows a scope the key holds', async () => {
    const { requireScope } = await import('@/lib/api/v1/keys');
    expect(() => requireScope({ keyId: 'k', userId: 'u', scopes: ['read'] }, 'read')).not.toThrow();
  });

  it('refuses a scope the key lacks, and names it', async () => {
    const { requireScope } = await import('@/lib/api/v1/keys');
    // Naming the scope is safe: the caller knows which key they used, and it
    // is the difference between a fixable integration and a support ticket.
    expect(() => requireScope({ keyId: 'k', userId: 'u', scopes: ['read'] }, 'write')).toThrow(
      /"write" scope/
    );
  });
});

describe('issuing', () => {
  it('stores a hash and never the key itself', async () => {
    const { issueApiKey } = await import('@/lib/api/v1/keys');
    const issued = await issueApiKey({ userId: 'u1', name: 'test', scopes: ['read'] });

    expect(issued.key).toMatch(/^owb_live_[A-Za-z0-9_-]{43}$/);

    const stored = inserted[0];
    expect(stored.key_hash).toBe(createHash('sha256').update(issued.key).digest('hex'));
    // The decisive assertion: the key must appear nowhere in the stored row.
    expect(JSON.stringify(stored)).not.toContain(issued.key.slice(9));
  });

  it('generates a distinct key every time', async () => {
    const { issueApiKey } = await import('@/lib/api/v1/keys');
    const keys = new Set<string>();
    for (let i = 0; i < 20; i++) {
      keys.add((await issueApiKey({ userId: 'u1', name: 'k', scopes: ['read'] })).key);
    }
    expect(keys.size).toBe(20);
  });

  it('stores a prefix short enough to be useless on its own', async () => {
    const { issueApiKey } = await import('@/lib/api/v1/keys');
    await issueApiKey({ userId: 'u1', name: 'test', scopes: ['read'] });
    const prefix = String(inserted[0].key_prefix);
    // 9 characters of literal prefix plus 4 of the secret: enough to tell two
    // keys apart in a list, nowhere near enough to narrow a search.
    expect(prefix).toHaveLength(13);
  });
});
