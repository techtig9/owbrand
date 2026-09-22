import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/lib/api/errors';

/**
 * Tenant-isolation tests for the authorization guards.
 *
 * These are the application-layer counterpart to supabase/test/rls-tests.sql:
 * the SQL suite proves the database refuses cross-tenant reads, this suite
 * proves the guards refuse them BEFORE the service-role client (which bypasses
 * RLS entirely) is ever used.
 *
 * The Supabase client is faked with a small in-memory store so the guards'
 * real query chains run unmodified.
 */

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CLEO = '33333333-3333-3333-3333-333333333333';

const ALICE_WS = 'aaaa0000-0000-0000-0000-00000000ffff';
const BOB_WS = 'bbbb0000-0000-0000-0000-00000000ffff';

const ALICE_BRAND = 'aaaaaaaa-0000-0000-0000-000000000001';
const BOB_BRAND = 'bbbbbbbb-0000-0000-0000-000000000001';

const ALICE_PRODUCT = 'aaaaaaaa-0000-0000-0000-0000000000a1';
const BOB_PRODUCT = 'bbbbbbbb-0000-0000-0000-0000000000b1';

interface Row {
  [key: string]: unknown;
}

/** Fixture data, reset before each test. */
let tables: Record<string, Row[]>;

function resetFixtures() {
  tables = {
    workspaces: [
      { id: ALICE_WS, owner_id: ALICE },
      { id: BOB_WS, owner_id: BOB },
    ],
    workspace_members: [
      // Cleo is an editor in Alice's workspace.
      { id: 'm1', workspace_id: ALICE_WS, user_id: CLEO, role: 'editor' },
    ],
    brands: [
      { id: ALICE_BRAND, user_id: ALICE, workspace_id: ALICE_WS, name: 'Alice Brand' },
      { id: BOB_BRAND, user_id: BOB, workspace_id: BOB_WS, name: 'Bob Brand' },
    ],
    products: [
      { id: ALICE_PRODUCT, brand_id: ALICE_BRAND, name: 'Alice Product' },
      { id: BOB_PRODUCT, brand_id: BOB_BRAND, name: 'Bob Product' },
    ],
    product_assets: [
      { id: 'asset-alice', product_id: ALICE_PRODUCT, url: 'a.png' },
      { id: 'asset-bob', product_id: BOB_PRODUCT, url: 'b.png' },
    ],
    content_assets: [
      { id: 'ca-alice', user_id: ALICE, brand_id: ALICE_BRAND, type: 'post' },
      { id: 'ca-bob', user_id: BOB, brand_id: BOB_BRAND, type: 'post' },
    ],
    campaigns: [
      { id: 'camp-alice', brand_id: ALICE_BRAND, name: 'Alice Campaign' },
      { id: 'camp-bob', brand_id: BOB_BRAND, name: 'Bob Campaign' },
    ],
  };
}

/** Minimal Supabase query-builder stand-in supporting the chains guards use. */
function makeFakeDb() {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((r) => values.includes(r[column]));
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          rows = rows.slice(0, n);
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        single() {
          return Promise.resolve(
            rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } }
          );
        },
        // Awaiting the builder itself resolves the list form.
        then(resolve: (value: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => makeFakeDb(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn(),
  supabaseServer: vi.fn(),
}));

const guards = await import('@/lib/auth/guards');
const { getCurrentUser } = await import('@/lib/supabase/server');

beforeEach(() => {
  resetFixtures();
  vi.mocked(getCurrentUser).mockReset();
});

describe('requireUser', () => {
  it('returns the session user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: ALICE,
      email: 'a@owbrand.test',
      name: 'Alice',
      role: 'user',
    });
    await expect(guards.requireUser()).resolves.toMatchObject({ id: ALICE });
  });

  it('raises 401 when there is no session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(guards.requireUser()).rejects.toThrowError(ApiError);
    await expect(guards.requireUser()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});

describe('requireAdminUser', () => {
  it('raises 403 for a non-admin', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: ALICE,
      email: 'a@owbrand.test',
      name: 'Alice',
      role: 'user',
    });
    await expect(guards.requireAdminUser()).rejects.toMatchObject({ status: 403 });
  });

  it('allows an admin', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: ALICE,
      email: 'a@owbrand.test',
      name: 'Alice',
      role: 'admin',
    });
    await expect(guards.requireAdminUser()).resolves.toMatchObject({ role: 'admin' });
  });
});

describe('assertBrandAccess — the core tenant boundary', () => {
  it('allows the direct owner', async () => {
    await expect(guards.assertBrandAccess(ALICE, ALICE_BRAND)).resolves.toMatchObject({ id: ALICE_BRAND });
  });

  it("REFUSES another tenant's brand", async () => {
    // This is the exact attack GET /api/campaigns and GET /api/products
    // permitted before Phase 1.
    await expect(guards.assertBrandAccess(ALICE, BOB_BRAND)).rejects.toMatchObject({ status: 404 });
  });

  it('allows a workspace member', async () => {
    await expect(guards.assertBrandAccess(CLEO, ALICE_BRAND)).resolves.toMatchObject({ id: ALICE_BRAND });
  });

  it("refuses a workspace member on an unrelated tenant's brand", async () => {
    await expect(guards.assertBrandAccess(CLEO, BOB_BRAND)).rejects.toMatchObject({ status: 404 });
  });

  it('raises 404, never 403, so brand ids cannot be enumerated', async () => {
    // A brand that exists but is not ours, and a brand that does not exist,
    // must be indistinguishable to the caller.
    const inaccessible = await guards.assertBrandAccess(ALICE, BOB_BRAND).catch((e) => e);
    const missing = await guards
      .assertBrandAccess(ALICE, '99999999-9999-9999-9999-999999999999')
      .catch((e) => e);

    expect(inaccessible.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(inaccessible.message).toBe(missing.message);
  });
});

describe('assertProductAccess', () => {
  it('allows the owner', async () => {
    await expect(guards.assertProductAccess(ALICE, ALICE_PRODUCT)).resolves.toMatchObject({
      product: { id: ALICE_PRODUCT },
    });
  });

  it("refuses another tenant's product", async () => {
    await expect(guards.assertProductAccess(ALICE, BOB_PRODUCT)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a mismatched brandId/productId pair', async () => {
    // Pairing your own brandId with someone else's productId must not work.
    await expect(
      guards.assertProductAccess(ALICE, BOB_PRODUCT, { brandId: ALICE_BRAND })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('assertProductAssetAccess', () => {
  it('allows the owner', async () => {
    await expect(guards.assertProductAssetAccess(ALICE, 'asset-alice')).resolves.toMatchObject({
      asset: { id: 'asset-alice' },
    });
  });

  it("refuses another tenant's asset", async () => {
    await expect(guards.assertProductAssetAccess(ALICE, 'asset-bob')).rejects.toMatchObject({ status: 404 });
  });
});

describe('assertContentAssetAccess', () => {
  it('allows the owner', async () => {
    await expect(guards.assertContentAssetAccess(ALICE, 'ca-alice')).resolves.toMatchObject({ id: 'ca-alice' });
  });

  it("refuses another tenant's content asset", async () => {
    await expect(guards.assertContentAssetAccess(ALICE, 'ca-bob')).rejects.toMatchObject({ status: 404 });
  });
});

describe('assertCampaignAccess', () => {
  it('allows the owner', async () => {
    await expect(guards.assertCampaignAccess(ALICE, 'camp-alice')).resolves.toMatchObject({
      campaign: { id: 'camp-alice' },
    });
  });

  it("refuses another tenant's campaign", async () => {
    await expect(guards.assertCampaignAccess(ALICE, 'camp-bob')).rejects.toMatchObject({ status: 404 });
  });
});

describe('assertWorkspaceAccess', () => {
  it('allows the owner', async () => {
    await expect(guards.assertWorkspaceAccess(ALICE, ALICE_WS)).resolves.toMatchObject({ id: ALICE_WS });
  });

  it('allows a member', async () => {
    await expect(guards.assertWorkspaceAccess(CLEO, ALICE_WS)).resolves.toMatchObject({ id: ALICE_WS });
  });

  it("refuses another tenant's workspace", async () => {
    await expect(guards.assertWorkspaceAccess(ALICE, BOB_WS)).rejects.toMatchObject({ status: 404 });
  });
});

describe('accessibleBrandIds', () => {
  it('returns owned brands', async () => {
    await expect(guards.accessibleBrandIds(ALICE)).resolves.toEqual([ALICE_BRAND]);
  });

  it('includes brands reachable through workspace membership', async () => {
    await expect(guards.accessibleBrandIds(CLEO)).resolves.toContain(ALICE_BRAND);
  });

  it('returns an empty array for a user with nothing — never an unfiltered set', async () => {
    // Callers must treat [] as "show nothing". The dashboard bug this replaces
    // ran an unscoped query, exposing every tenant's recommendations.
    await expect(
      guards.accessibleBrandIds('44444444-4444-4444-4444-444444444444')
    ).resolves.toEqual([]);
  });
});

describe('assertStoragePathOwnership', () => {
  it('accepts a path under the caller’s own prefix', () => {
    expect(guards.assertStoragePathOwnership(ALICE, `${ALICE}/brand/product/file.png`)).toBe(
      `${ALICE}/brand/product/file.png`
    );
  });

  it("refuses another tenant's prefix", () => {
    expect(() => guards.assertStoragePathOwnership(ALICE, `${BOB}/brand/product/file.png`)).toThrowError(
      ApiError
    );
  });

  it('refuses path traversal', () => {
    expect(() => guards.assertStoragePathOwnership(ALICE, `${ALICE}/../${BOB}/file.png`)).toThrowError(ApiError);
    // The URL-encoded form is rejected too. Storage SDKs may decode the path
    // before using it, so treating any '..' as hostile is the safe default.
    expect(() => guards.assertStoragePathOwnership(ALICE, `${ALICE}/..%2f${BOB}/f.png`)).toThrowError(ApiError);
    expect(() => guards.assertStoragePathOwnership(ALICE, `${ALICE}/sub/../../${BOB}/f.png`)).toThrowError(
      ApiError
    );
  });

  it('refuses backslashes and null bytes', () => {
    expect(() => guards.assertStoragePathOwnership(ALICE, `${ALICE}\\${BOB}\\f.png`)).toThrowError(ApiError);
    expect(() => guards.assertStoragePathOwnership(ALICE, `${ALICE}/f\0.png`)).toThrowError(ApiError);
  });

  it('refuses a bare prefix with no file', () => {
    expect(() => guards.assertStoragePathOwnership(ALICE, ALICE)).toThrowError(ApiError);
  });

  it('normalises a leading slash', () => {
    expect(guards.assertStoragePathOwnership(ALICE, `/${ALICE}/b/p/f.png`)).toBe(`${ALICE}/b/p/f.png`);
  });
});
