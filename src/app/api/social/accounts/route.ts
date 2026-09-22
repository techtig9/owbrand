import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseJsonBody, parseSearchParams, uuidSchema } from '@/lib/api/validate';
import { requireUser, assertBrandAccess, accessibleBrandIds } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { accountHealth, accessTokenFor, markAccountRevoked, type SocialAccountRow } from '@/lib/social/account-store';
import { revokePermissions } from '@/lib/social/providers/meta-client';
import { PLATFORMS, SOCIAL_PLATFORMS, type SocialPlatform } from '@/lib/social/platforms';
import { isConfigured } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Connected accounts: list and disconnect.
 *
 * Replaces `/api/social/connect-account`, which has been deleted. That route
 * accepted an `oauthCode` from the client and stored
 * `placeholder_token_for_<code>` as the access token — so every account looked
 * connected, publishing could never work, and the master command's first
 * instruction for this area was to remove exactly that behaviour. Connecting
 * now happens through /api/social/oauth/start and its callback, which is the
 * only path that produces a real credential.
 *
 * GET never returns a token, ciphertext, or anything derived from one.
 */

const ListQuery = z.object({
  brandId: uuidSchema.optional(),
});

export const GET = routeHandler('/api/social/accounts', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const query = parseSearchParams(request, ListQuery);
  const db = supabaseAdmin();

  if (query.brandId) await assertBrandAccess(user.id, query.brandId, { db });

  const brandIds = query.brandId ? [query.brandId] : await accessibleBrandIds(user.id, db);

  // A connection belongs to the user who authorised it, and may additionally
  // be scoped to a brand. Both paths are included; nothing outside them is.
  let queryBuilder = db
    .from('social_accounts')
    .select(
      'id, user_id, brand_id, platform, account_name, external_account_id, external_page_id, granted_scopes, token_expires_at, status, last_error, last_error_at, last_verified_at, connected_at, access_token_ciphertext, metadata'
    )
    .neq('status', 'revoked');

  queryBuilder =
    brandIds.length > 0
      ? queryBuilder.or(`user_id.eq.${user.id},brand_id.in.(${brandIds.join(',')})`)
      : queryBuilder.eq('user_id', user.id);

  const { data, error } = await queryBuilder;
  if (error) throw error;

  const rows = (data ?? []) as SocialAccountRow[];

  const accounts = rows.map((row) => {
    const health = accountHealth(row);
    return {
      id: row.id,
      platform: row.platform,
      label: PLATFORMS[row.platform].label,
      accountName: row.account_name,
      brandId: row.brand_id,
      externalAccountId: row.external_account_id,
      connectedAt: row.connected_at,
      status: health.status,
      usable: health.usable,
      expiresInDays: health.expiresInDays,
      missingScopes: health.missingScopes,
      lastError: row.last_error,
      lastErrorAt: row.last_error_at,
      lastVerifiedAt: row.last_verified_at,
      // Whether a credential exists at all — never the credential.
      hasStoredCredential: Boolean(row.access_token_ciphertext),
    };
  });

  // Every platform, connected or not, so the UI can show what is possible and
  // what is honestly out of reach.
  const platforms = SOCIAL_PLATFORMS.map((platform) => ({
    platform,
    label: PLATFORMS[platform].label,
    publishSupported: PLATFORMS[platform].publish === 'available',
    oauthProvider: PLATFORMS[platform].oauthProvider,
    unavailableReason: PLATFORMS[platform].unavailableReason ?? null,
    connectedCount: accounts.filter((account) => account.platform === platform).length,
  }));

  return NextResponse.json({
    accounts,
    platforms,
    // Configuration is an operator fact, not a secret, and the UI must not
    // offer a Connect button that leads to a 503.
    oauthConfigured: { meta: isConfigured.metaOAuth() },
  });
});

const DisconnectBody = z.object({
  accountId: uuidSchema,
  /**
   * Ask the provider to revoke our permissions as well as forgetting the
   * credential locally. Defaults to true: a user who clicks Disconnect means
   * "stop having access", not "hide it from me".
   */
  revokeAtProvider: z.boolean().default(true),
});

export const DELETE = routeHandler('/api/social/accounts', async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit('standard', user.id);

  const body = await parseJsonBody(request, DisconnectBody);
  const db = supabaseAdmin();

  const { data } = await db
    .from('social_accounts')
    .select('id, user_id, brand_id, platform, external_account_id, access_token_ciphertext, metadata, status, granted_scopes, token_expires_at, account_name, external_page_id, last_error, last_error_at, last_verified_at, connected_at')
    .eq('id', body.accountId)
    .maybeSingle();

  const account = data as SocialAccountRow | null;

  // Missing and inaccessible are both 404, so account ids cannot be probed.
  if (!account) throw ApiError.notFound('Connected account not found.');

  if (account.user_id !== user.id) {
    if (!account.brand_id) throw ApiError.notFound('Connected account not found.');
    await assertBrandAccess(user.id, account.brand_id, { db });
  }

  // Revoke at the provider before destroying the credential locally —
  // afterwards we would have nothing to authenticate the revoke call with.
  if (body.revokeAtProvider) {
    await attemptProviderRevoke(account);
  }

  await markAccountRevoked(account.id, db);

  await db.from('audit_logs').insert({
    actor_id: user.id,
    actor_type: 'user',
    action: 'social.disconnect',
    entity_type: 'social_account',
    entity_id: account.id,
    metadata: { platform: account.platform, revokeRequested: body.revokeAtProvider },
  });

  logger.info('social:disconnected', { userId: user.id, accountId: account.id, platform: account.platform });

  return NextResponse.json({ ok: true, accountId: account.id, status: 'revoked' });
});

/**
 * Best-effort provider-side revocation.
 *
 * A failure here must not block the local disconnect: the user asked to
 * disconnect, and refusing because Meta is unreachable would leave the
 * credential in our database — the opposite of what they wanted. The outcome
 * is reported in the log so an operator can see it happened.
 */
async function attemptProviderRevoke(account: SocialAccountRow): Promise<void> {
  const provider = PLATFORMS[account.platform as SocialPlatform].oauthProvider;
  if (provider !== 'meta' || !isConfigured.metaOAuth()) return;

  const metaUserId = (account.metadata as { metaUserId?: string } | null)?.metaUserId;
  if (!metaUserId) {
    logger.info('social:revoke_skipped', { accountId: account.id, reason: 'no_provider_user_id' });
    return;
  }

  try {
    const token = accessTokenFor(account);
    await revokePermissions(metaUserId, token);
    logger.info('social:revoked_at_provider', { accountId: account.id, platform: account.platform });
  } catch (error) {
    logger.warn('social:revoke_failed', {
      accountId: account.id,
      platform: account.platform,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
