import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { encryptSecret, decryptSecret, socialTokenContext } from '@/lib/crypto/secret-box';
import { PublishError } from '@/lib/social/errors';
import { PLATFORMS, type SocialPlatform } from '@/lib/social/platforms';
import { logger } from '@/lib/logger';

/**
 * Connected social accounts, and their credentials.
 *
 * Credentials are encrypted before they reach the database and decrypted only
 * inside the worker at publish time. Nothing in this module returns a token to
 * a caller that did not explicitly ask for one, and the API layer never asks.
 *
 * `access_token` — the legacy plaintext column — is never written again. It is
 * left in place because dropping a column that may hold real data in someone's
 * deployment is not a migration to run blind; the Phase 3 migration makes it
 * nullable and comments it as deprecated.
 */

type Db = SupabaseClient<any, any, any>;

export type AccountStatus = 'active' | 'expiring' | 'needs_reconnect' | 'revoked' | 'error';

export interface SocialAccountRow {
  id: string;
  user_id: string;
  brand_id: string | null;
  platform: SocialPlatform;
  account_name: string | null;
  external_account_id: string | null;
  external_page_id: string | null;
  granted_scopes: string[] | null;
  token_expires_at: string | null;
  status: AccountStatus;
  last_error: string | null;
  last_error_at: string | null;
  last_verified_at: string | null;
  connected_at: string;
  access_token_ciphertext: string | null;
  metadata: Record<string, unknown> | null;
}

/** How long before expiry an account starts warning the user. */
const EXPIRY_WARNING_DAYS = 7;

export interface UpsertAccountInput {
  userId: string;
  brandId: string | null;
  platform: SocialPlatform;
  accountName: string | null;
  externalAccountId: string;
  externalPageId: string | null;
  accessToken: string;
  grantedScopes: string[];
  tokenExpiresAt: Date | null;
  metadata?: Record<string, unknown>;
}

/**
 * Stores or refreshes a connection.
 *
 * The credential is encrypted with a context bound to the account row's id,
 * which creates a chicken-and-egg problem on insert: the id does not exist
 * yet. Resolved by writing the row first without a credential, then
 * encrypting against the real id and updating — so a ciphertext can never be
 * valid for a row other than the one it was written for.
 */
export async function upsertSocialAccount(
  input: UpsertAccountInput,
  db: Db = supabaseAdmin()
): Promise<SocialAccountRow> {
  const missingScopes = PLATFORMS[input.platform].scopes.filter(
    (scope) => !input.grantedScopes.includes(scope)
  );

  // An account missing a publish scope is connected but not usable. Recording
  // that as `needs_reconnect` up front is the difference between telling the
  // user now and telling them when a scheduled post fails.
  const status: AccountStatus = missingScopes.length > 0 ? 'needs_reconnect' : 'active';

  const base = {
    user_id: input.userId,
    brand_id: input.brandId,
    platform: input.platform,
    account_name: input.accountName,
    external_account_id: input.externalAccountId,
    external_page_id: input.externalPageId,
    granted_scopes: input.grantedScopes,
    token_expires_at: input.tokenExpiresAt?.toISOString() ?? null,
    status,
    last_error: missingScopes.length > 0 ? `Missing permission(s): ${missingScopes.join(', ')}.` : null,
    last_error_at: missingScopes.length > 0 ? new Date().toISOString() : null,
    last_verified_at: new Date().toISOString(),
    revoked_at: null,
    metadata: { ...(input.metadata ?? {}), missingScopes },
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('social_accounts')
    .upsert(base, { onConflict: 'user_id,platform,brand_id' })
    .select('*')
    .single();

  if (error) throw error;

  const row = data as SocialAccountRow;

  const ciphertext = encryptSecret(input.accessToken, socialTokenContext(row.id, 'access'));

  const { data: updated, error: updateError } = await db
    .from('social_accounts')
    .update({ access_token_ciphertext: ciphertext, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select('*')
    .single();

  if (updateError) {
    // The row exists but carries no usable credential. Mark it so nothing
    // downstream treats it as publishable.
    await db
      .from('social_accounts')
      .update({ status: 'error', last_error: 'Could not store the credential.' })
      .eq('id', row.id);
    throw updateError;
  }

  logger.info('social:account_connected', {
    userId: input.userId,
    platform: input.platform,
    accountId: row.id,
    status,
    missingScopes: missingScopes.length,
  });

  return updated as SocialAccountRow;
}

/**
 * Decrypts an account's access token.
 *
 * Only the worker calls this. A decryption failure means the credential is
 * unusable, so it is reported as `needs_reconnect` rather than retried: no
 * amount of waiting will make the wrong key right.
 */
export function accessTokenFor(account: SocialAccountRow): string {
  if (!account.access_token_ciphertext) {
    throw new PublishError(
      'needs_reconnect',
      'no_stored_credential',
      'This account has no stored credential. Reconnect it to publish.'
    );
  }

  try {
    return decryptSecret(account.access_token_ciphertext, socialTokenContext(account.id, 'access'));
  } catch (error) {
    logger.error('social:token_decrypt_failed', error, { accountId: account.id, platform: account.platform });
    throw new PublishError(
      'needs_reconnect',
      'credential_undecryptable',
      'The stored credential for this account could not be read. Reconnect it to publish.'
    );
  }
}

/** Fetches the account to publish a brand's post with, or null. */
export async function accountForBrandPlatform(
  brandId: string,
  platform: SocialPlatform,
  db: Db = supabaseAdmin()
): Promise<SocialAccountRow | null> {
  // Prefer an account bound to this brand; fall back to the owner's
  // brand-agnostic connection, which is how the legacy rows were written.
  const { data } = await db
    .from('social_accounts')
    .select('*')
    .eq('platform', platform)
    .or(`brand_id.eq.${brandId},brand_id.is.null`)
    .neq('status', 'revoked')
    // Brand-specific rows sort before the null-brand fallback.
    .order('brand_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return (data as SocialAccountRow | null) ?? null;
}

/** Derives the health of an account without calling the provider. */
export function accountHealth(account: SocialAccountRow): {
  status: AccountStatus;
  expiresInDays: number | null;
  missingScopes: string[];
  usable: boolean;
} {
  const missingScopes = PLATFORMS[account.platform].scopes.filter(
    (scope) => !(account.granted_scopes ?? []).includes(scope)
  );

  let expiresInDays: number | null = null;
  if (account.token_expires_at) {
    const ms = new Date(account.token_expires_at).getTime() - Date.now();
    expiresInDays = Math.floor(ms / 86_400_000);
  }

  let status: AccountStatus = account.status;

  // Expiry overrides a stored 'active': a token that lapsed since the last
  // write is not active, whatever the column says.
  if (expiresInDays !== null && expiresInDays <= 0) status = 'needs_reconnect';
  else if (status === 'active' && expiresInDays !== null && expiresInDays <= EXPIRY_WARNING_DAYS) status = 'expiring';

  if (missingScopes.length > 0 && status === 'active') status = 'needs_reconnect';

  return {
    status,
    expiresInDays,
    missingScopes,
    // 'expiring' is still usable — that is the point of warning early.
    usable: status === 'active' || status === 'expiring',
  };
}

/** Records a publish failure against the account, for the connections UI. */
export async function recordAccountError(
  accountId: string,
  error: PublishError,
  db: Db = supabaseAdmin()
): Promise<void> {
  const status: AccountStatus = error.kind === 'needs_reconnect' ? 'needs_reconnect' : 'error';

  const { error: updateError } = await db
    .from('social_accounts')
    .update({
      status,
      last_error: error.message.slice(0, 500),
      last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (updateError) {
    logger.warn('social:account_error_write_failed', { accountId, error: String(updateError.message) });
  }
}

/** Clears the error state after a successful publish. */
export async function recordAccountSuccess(accountId: string, db: Db = supabaseAdmin()): Promise<void> {
  await db
    .from('social_accounts')
    .update({
      status: 'active',
      last_error: null,
      last_error_at: null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);
}

/**
 * Marks an account revoked and destroys the stored credential.
 *
 * Deleting the row would lose the audit trail of what was once connected;
 * nulling the ciphertext means the credential is gone either way.
 */
export async function markAccountRevoked(accountId: string, db: Db = supabaseAdmin()): Promise<void> {
  const { error } = await db
    .from('social_accounts')
    .update({
      status: 'revoked',
      access_token_ciphertext: null,
      refresh_token_ciphertext: null,
      access_token: null,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (error) throw error;
}
