import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { requireUser, accessibleBrandIds } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Data export.
 *
 * Returns everything the account owns as one JSON document, as a download.
 *
 * What it deliberately does NOT include:
 *
 *   - **Social access tokens.** They are encrypted at rest and exporting them
 *     would hand a plaintext credential to whatever the browser does with a
 *     downloaded file. The connection is exported; the secret is not. An
 *     export that leaks a token is worse than no export.
 *   - **Other people's data.** Brands are resolved through
 *     `accessibleBrandIds`, so a workspace member exports the brands they can
 *     see — and nothing from a workspace they left.
 *
 * Only brand-scoped rows are fetched, and only for brands this user can
 * access, so there is no path here that reads across tenants.
 */
export const GET = routeHandler('/api/account/export', async (_request: Request) => {
  const user = await requireUser();
  // Tighter than `standard`: an export is a full table read per call.
  await enforceRateLimit('billing', user.id);

  const db = supabaseAdmin();
  const brandIds = await accessibleBrandIds(user.id, db);

  const scoped = <T = unknown>(table: string, columns = '*') =>
    brandIds.length > 0
      ? db.from(table).select(columns).in('brand_id', brandIds)
      : Promise.resolve({ data: [] as T[] });

  const [profile, subscription, brands, products, facts, assets, posts, accounts, ledger, payments] =
    await Promise.all([
      db.from('users').select('id, email, name, role, created_at').eq('id', user.id).maybeSingle(),
      db
        .from('subscriptions')
        .select('plan, status, credits_remaining, renews_at')
        .eq('user_id', user.id)
        .maybeSingle(),
      scoped('brands'),
      scoped('products'),
      brandIds.length > 0
        ? db
            .from('products')
            .select('id')
            .in('brand_id', brandIds)
            .then(async (res) => {
              const ids = (res.data ?? []).map((r) => r.id as string);
              return ids.length > 0
                ? db.from('product_facts').select('*').in('product_id', ids)
                : { data: [] };
            })
        : Promise.resolve({ data: [] }),
      scoped('content_assets'),
      scoped('social_posts'),
      // Explicit column list: `*` would include the encrypted token column.
      scoped('social_accounts', 'id, brand_id, platform, account_name, external_id, status, created_at'),
      db.from('credit_ledger').select('*').eq('user_id', user.id),
      db.from('payments').select('paddle_transaction_id, amount, status, created_at').eq('user_id', user.id),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    notice:
      'Social access tokens are deliberately excluded: they are encrypted at rest and exporting them would produce a plaintext credential in a downloaded file.',
    profile: profile.data ?? null,
    subscription: subscription.data ?? null,
    brands: brands.data ?? [],
    products: products.data ?? [],
    productFacts: facts.data ?? [],
    contentAssets: assets.data ?? [],
    socialPosts: posts.data ?? [],
    socialAccounts: accounts.data ?? [],
    creditLedger: ledger.data ?? [],
    payments: payments.data ?? [],
  };

  await db.from('audit_logs').insert({
    actor_id: user.id,
    actor_type: 'user',
    action: 'account.exported',
    entity_type: 'user',
    entity_id: user.id,
    metadata: { brands: brandIds.length },
  });

  logger.info('account:exported', { brands: brandIds.length });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="owbrand-export-${new Date().toISOString().slice(0, 10)}.json"`,
      // Never cached: this is the user's whole account in one response.
      'Cache-Control': 'no-store, private',
    },
  });
});
