import { describe, it, expect, vi } from 'vitest';
import { createOAuthState, consumeOAuthState } from '@/lib/social/oauth-state';

/**
 * OAuth state.
 *
 * This is the control that prevents an account-linking attack: an attacker
 * starting a flow with their own social account, capturing the `?code=`, and
 * getting a victim to load our callback with it. The properties that make it
 * work are (a) the state is unguessable, (b) it can only be consumed once,
 * and (c) the user is read FROM the row rather than taken from the request.
 *
 * The single-use guarantee itself is enforced by the database — the
 * conditional UPDATE is asserted against real Postgres in
 * supabase/test/rls-tests.sql. These tests assert the query this module
 * actually builds, because a missing `.is('consumed_at', null)` would compile,
 * pass every other test, and silently make states replayable.
 */

/** Records the filters applied, so the built query can be inspected. */
function fakeDb(result: { data: unknown; error?: unknown }) {
  const filters: Array<{ op: string; args: unknown[] }> = [];
  const inserted: unknown[] = [];

  const builder: Record<string, unknown> = {};
  const chain = (op: string) =>
    (...args: unknown[]) => {
      filters.push({ op, args });
      return builder;
    };

  Object.assign(builder, {
    update: chain('update'),
    eq: chain('eq'),
    is: chain('is'),
    gt: chain('gt'),
    select: chain('select'),
    maybeSingle: async () => result,
    insert: async (row: unknown) => {
      inserted.push(row);
      return { error: result.error ?? null };
    },
  });

  return {
    db: { from: (table: string) => { filters.push({ op: 'from', args: [table] }); return builder; } } as never,
    filters,
    inserted,
  };
}

describe('createOAuthState', () => {
  it('mints a long random state', async () => {
    const { db, inserted } = fakeDb({ data: null });

    const state = await createOAuthState(
      { userId: 'u1', provider: 'meta', requestedScopes: ['instagram_basic'] },
      db
    );

    // 32 bytes hex. Short enough to guess is the whole attack.
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect((inserted[0] as { state: string }).state).toBe(state);
  });

  it('never issues the same state twice', async () => {
    const { db } = fakeDb({ data: null });
    const states = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      states.add(await createOAuthState({ userId: 'u1', provider: 'meta', requestedScopes: [] }, db));
    }
    expect(states.size).toBe(50);
  });

  it('binds the state to the user who started the flow', async () => {
    const { db, inserted } = fakeDb({ data: null });
    await createOAuthState({ userId: 'u1', brandId: 'b1', provider: 'meta', requestedScopes: [] }, db);

    expect(inserted[0]).toMatchObject({ user_id: 'u1', brand_id: 'b1', provider: 'meta' });
  });

  it('sanitises the return path at issue time', async () => {
    const { db, inserted } = fakeDb({ data: null });

    // An open redirect here would send the user off-site carrying our
    // callback's query string.
    await createOAuthState(
      { userId: 'u1', provider: 'meta', requestedScopes: [], returnTo: 'https://evil.test/steal' },
      db
    );

    expect((inserted[0] as { return_to: string }).return_to).toBe('/dashboard/settings');
  });

  it('rejects a protocol-relative return path', async () => {
    const { db, inserted } = fakeDb({ data: null });
    await createOAuthState({ userId: 'u1', provider: 'meta', requestedScopes: [], returnTo: '//evil.test' }, db);
    expect((inserted[0] as { return_to: string }).return_to).toBe('/dashboard/settings');
  });

  it('keeps a legitimate local path', async () => {
    const { db, inserted } = fakeDb({ data: null });
    await createOAuthState(
      { userId: 'u1', provider: 'meta', requestedScopes: [], returnTo: '/dashboard/connections' },
      db
    );
    expect((inserted[0] as { return_to: string }).return_to).toBe('/dashboard/connections');
  });
});

describe('consumeOAuthState', () => {
  const validRow = {
    user_id: 'u1',
    brand_id: 'b1',
    provider: 'meta',
    requested_scopes: ['instagram_basic'],
    return_to: '/dashboard/connections',
  };

  it('returns the row the state belongs to', async () => {
    const { db } = fakeDb({ data: validRow });
    const consumed = await consumeOAuthState('a'.repeat(64), 'meta', db);

    expect(consumed).toEqual({
      userId: 'u1',
      brandId: 'b1',
      provider: 'meta',
      requestedScopes: ['instagram_basic'],
      returnTo: '/dashboard/connections',
    });
  });

  it('claims the row with an UPDATE, not a read-then-write', async () => {
    // A SELECT followed by an UPDATE would let two concurrent callbacks both
    // succeed. The claim has to be one atomic statement.
    const { db, filters } = fakeDb({ data: validRow });
    await consumeOAuthState('a'.repeat(64), 'meta', db);

    const ops = filters.map((f) => f.op);
    expect(ops).toContain('update');
    expect(ops.indexOf('update')).toBeLessThan(ops.indexOf('select'));
  });

  it('filters on unconsumed AND unexpired', async () => {
    const { db, filters } = fakeDb({ data: validRow });
    await consumeOAuthState('a'.repeat(64), 'meta', db);

    // Losing either predicate makes captured callback URLs replayable.
    const isFilters = filters.filter((f) => f.op === 'is');
    expect(isFilters.some((f) => f.args[0] === 'consumed_at' && f.args[1] === null)).toBe(true);

    const gtFilters = filters.filter((f) => f.op === 'gt');
    expect(gtFilters.some((f) => f.args[0] === 'expires_at')).toBe(true);
  });

  it('scopes the claim to the provider as well as the state', async () => {
    const { db, filters } = fakeDb({ data: validRow });
    await consumeOAuthState('a'.repeat(64), 'meta', db);

    const eqFilters = filters.filter((f) => f.op === 'eq');
    expect(eqFilters.some((f) => f.args[0] === 'state')).toBe(true);
    expect(eqFilters.some((f) => f.args[0] === 'provider' && f.args[1] === 'meta')).toBe(true);
  });

  it('returns null when no row matched — no exception to leak which case', async () => {
    const { db } = fakeDb({ data: null });
    expect(await consumeOAuthState('a'.repeat(64), 'meta', db)).toBeNull();
  });

  it('returns null on a database error rather than throwing into the callback', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'connection lost' } });
    expect(await consumeOAuthState('a'.repeat(64), 'meta', db)).toBeNull();
  });

  it('rejects a short state without touching the database', async () => {
    const from = vi.fn();
    expect(await consumeOAuthState('short', 'meta', { from } as never)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects an empty or non-string state', async () => {
    const from = vi.fn();
    expect(await consumeOAuthState('', 'meta', { from } as never)).toBeNull();
    expect(await consumeOAuthState(undefined as never, 'meta', { from } as never)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('tolerates a row with no scopes recorded', async () => {
    const { db } = fakeDb({ data: { ...validRow, requested_scopes: null } });
    const consumed = await consumeOAuthState('a'.repeat(64), 'meta', db);
    expect(consumed?.requestedScopes).toEqual([]);
  });
});
