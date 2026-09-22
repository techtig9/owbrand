import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { debugToken, exchangeForLongLivedToken, listPages } from './providers/meta-client';
import { accessTokenFor, accountHealth, type SocialAccountRow } from './account-store';
import { encryptSecret, socialTokenContext } from '@/lib/crypto/secret-box';
import { PublishError } from './errors';
import { PLATFORMS } from './platforms';
import { isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Keeps connections alive, and tells the truth when they are not.
 *
 * Meta's model is the reason this exists. A Page token derived from a
 * long-lived user token does not expire on its own — but the *user* token
 * behind it does, roughly every 60 days, and when it lapses the derived Page
 * tokens stop working too. An integration that never refreshes works
 * beautifully for two months and then every scheduled post fails at once,
 * with no warning and an error that reads like a platform outage.
 *
 * So this runs on a schedule and does three things per account:
 *   1. Inspects the token: is it valid, what scopes were granted, when does it
 *      expire?
 *   2. Refreshes it while it still can — Meta only extends a token that is
 *      still valid, so waiting until expiry is waiting too long.
 *   3. Writes the honest status. An account that cannot be refreshed becomes
 *      `needs_reconnect` here, days before a post would have failed.
 */

type Db = SupabaseClient<any, any, any>;

/** Refresh when fewer than this many days remain. Meta tokens last ~60. */
const REFRESH_WINDOW_DAYS = 14;

export interface AccountRefreshOutcome {
  accountId: string;
  platform: string;
  action: 'refreshed' | 'verified' | 'needs_reconnect' | 'skipped' | 'error';
  detail?: string;
}

export interface RefreshRunResult {
  checked: number;
  refreshed: number;
  needsReconnect: number;
  errors: number;
  outcomes: AccountRefreshOutcome[];
}

/**
 * Verifies (and where needed refreshes) every live connection.
 *
 * Never throws for one bad account: a single revoked connection must not stop
 * the other tenants' accounts being checked.
 */
export async function refreshSocialAccounts(options: { limit?: number; db?: Db } = {}): Promise<RefreshRunResult> {
  const db = options.db ?? supabaseAdmin();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  const result: RefreshRunResult = { checked: 0, refreshed: 0, needsReconnect: 0, errors: 0, outcomes: [] };

  if (!isConfigured.metaOAuth()) {
    // Nothing to check, and nothing to pretend about.
    return result;
  }

  const { data, error } = await db
    .from('social_accounts')
    .select(
      'id, user_id, brand_id, platform, account_name, external_account_id, external_page_id, granted_scopes, token_expires_at, status, last_error, last_error_at, last_verified_at, connected_at, access_token_ciphertext, metadata'
    )
    .neq('status', 'revoked')
    .not('access_token_ciphertext', 'is', null)
    // Oldest verification first, so a large tenant base is worked through
    // across runs rather than the same accounts every time.
    .order('last_verified_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw error;

  const accounts = (data ?? []) as SocialAccountRow[];
  result.checked = accounts.length;

  for (const account of accounts) {
    const outcome = await processAccount(account, db);
    result.outcomes.push(outcome);

    if (outcome.action === 'refreshed') result.refreshed += 1;
    else if (outcome.action === 'needs_reconnect') result.needsReconnect += 1;
    else if (outcome.action === 'error') result.errors += 1;
  }

  logger.info('social_refresh:completed', {
    checked: result.checked,
    refreshed: result.refreshed,
    needsReconnect: result.needsReconnect,
    errors: result.errors,
  });

  return result;
}

async function processAccount(account: SocialAccountRow, db: Db): Promise<AccountRefreshOutcome> {
  const base = { accountId: account.id, platform: account.platform };

  if (PLATFORMS[account.platform].oauthProvider !== 'meta') {
    return { ...base, action: 'skipped', detail: 'No refresh flow for this provider.' };
  }

  let token: string;
  try {
    token = accessTokenFor(account);
  } catch (error) {
    // Undecryptable credential — the key changed, or the row was tampered
    // with. Reconnecting is the only fix.
    await writeStatus(account.id, 'needs_reconnect', 'The stored credential could not be read. Reconnect the account.', db);
    return {
      ...base,
      action: 'needs_reconnect',
      detail: error instanceof PublishError ? error.code : 'credential_unreadable',
    };
  }

  try {
    const inspection = await debugToken(token);
    const grantedScopes = inspection.data?.scopes ?? account.granted_scopes ?? [];
    const isValid = inspection.data?.is_valid !== false;

    if (!isValid) {
      await writeStatus(account.id, 'needs_reconnect', 'The platform reports this credential as no longer valid.', db, {
        granted_scopes: grantedScopes,
      });
      return { ...base, action: 'needs_reconnect', detail: 'token_invalid' };
    }

    const missingScopes = PLATFORMS[account.platform].scopes.filter((scope) => !grantedScopes.includes(scope));

    if (missingScopes.length > 0) {
      await writeStatus(
        account.id,
        'needs_reconnect',
        `Missing permission(s): ${missingScopes.join(', ')}.`,
        db,
        { granted_scopes: grantedScopes }
      );
      return { ...base, action: 'needs_reconnect', detail: `missing_scopes:${missingScopes.length}` };
    }

    // 0 means "does not expire" in Meta's model, not 1970.
    const rawExpiry = inspection.data?.expires_at;
    const expiresAt = typeof rawExpiry === 'number' && rawExpiry > 0 ? new Date(rawExpiry * 1000) : null;

    const daysRemaining = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null;

    if (daysRemaining !== null && daysRemaining <= REFRESH_WINDOW_DAYS) {
      return await refreshAccount(account, token, grantedScopes, db);
    }

    await writeStatus(account.id, 'active', null, db, {
      granted_scopes: grantedScopes,
      token_expires_at: expiresAt?.toISOString() ?? null,
    });

    return { ...base, action: 'verified', detail: daysRemaining === null ? 'no_expiry' : `${daysRemaining}d remaining` };
  } catch (error) {
    if (error instanceof PublishError && error.kind === 'needs_reconnect') {
      await writeStatus(account.id, 'needs_reconnect', error.message, db);
      return { ...base, action: 'needs_reconnect', detail: error.code };
    }

    // A transient Graph failure must not downgrade a working account. Record
    // the error, leave the status alone, and try again next run.
    logger.warn('social_refresh:check_failed', {
      accountId: account.id,
      platform: account.platform,
      error: error instanceof Error ? error.message : String(error),
    });

    return { ...base, action: 'error', detail: error instanceof PublishError ? error.code : 'check_failed' };
  }
}

/**
 * Extends the credential.
 *
 * The exchange returns a new long-lived USER token; the Page tokens then have
 * to be re-read, because the ones we hold were derived from the old user
 * token. Skipping that second step is the subtle version of the same bug:
 * refreshing something the publisher does not use.
 */
async function refreshAccount(
  account: SocialAccountRow,
  currentToken: string,
  grantedScopes: string[],
  db: Db
): Promise<AccountRefreshOutcome> {
  const base = { accountId: account.id, platform: account.platform };

  try {
    const refreshed = await exchangeForLongLivedToken(currentToken);
    const pages = await listPages(refreshed.access_token);

    // Match on the recorded page id — for Instagram that is the LINKED page,
    // not the IG account id.
    const pageId = account.external_page_id ?? account.external_account_id;
    const page = pages.find((candidate) => candidate.id === pageId);

    if (!page) {
      await writeStatus(
        account.id,
        'needs_reconnect',
        'This account is no longer among the Pages you administer. Reconnect it.',
        db
      );
      return { ...base, action: 'needs_reconnect', detail: 'page_no_longer_available' };
    }

    const expiresAt =
      typeof refreshed.expires_in === 'number' && refreshed.expires_in > 0
        ? new Date(Date.now() + refreshed.expires_in * 1000)
        : null;

    const ciphertext = encryptSecret(page.access_token, socialTokenContext(account.id, 'access'));

    const { error } = await db
      .from('social_accounts')
      .update({
        access_token_ciphertext: ciphertext,
        granted_scopes: grantedScopes,
        token_expires_at: expiresAt?.toISOString() ?? null,
        status: 'active',
        last_error: null,
        last_error_at: null,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    if (error) throw error;

    logger.info('social_refresh:refreshed', {
      accountId: account.id,
      platform: account.platform,
      expiresAt: expiresAt?.toISOString() ?? null,
    });

    return { ...base, action: 'refreshed' };
  } catch (error) {
    // A failed refresh close to expiry is worth surfacing now rather than
    // letting the token lapse silently.
    const health = accountHealth(account);
    const urgent = health.expiresInDays !== null && health.expiresInDays <= 3;

    if (urgent) {
      await writeStatus(
        account.id,
        'needs_reconnect',
        'This connection is about to expire and could not be renewed automatically. Reconnect it.',
        db
      );
      return { ...base, action: 'needs_reconnect', detail: 'refresh_failed_near_expiry' };
    }

    logger.warn('social_refresh:refresh_failed', {
      accountId: account.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return { ...base, action: 'error', detail: 'refresh_failed' };
  }
}

async function writeStatus(
  accountId: string,
  status: 'active' | 'needs_reconnect' | 'error',
  message: string | null,
  db: Db,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await db
    .from('social_accounts')
    .update({
      status,
      last_error: message,
      last_error_at: message ? new Date().toISOString() : null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq('id', accountId);

  if (error) {
    logger.warn('social_refresh:status_write_failed', { accountId, error: String(error.message) });
  }
}
