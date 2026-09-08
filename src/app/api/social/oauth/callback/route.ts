import { NextResponse } from 'next/server';
import { consumeOAuthState } from '@/lib/social/oauth-state';
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  debugToken,
  listPages,
  type MetaPage,
} from '@/lib/social/providers/meta-client';
import { upsertSocialAccount } from '@/lib/social/account-store';
import { safeRedirectPath } from '@/lib/security/redirect';
import { publicEnv, isConfigured } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * The OAuth redirect target.
 *
 * This endpoint is reached by the user's browser following a provider
 * redirect, so it cannot require a JSON body or a bearer token — which makes
 * the state row the ONLY thing establishing who the flow belongs to. It is
 * validated and consumed before the authorization code is touched.
 *
 * Deliberate choices:
 *
 *   - It never trusts `state` to name a user; it looks the user up FROM the
 *     state row. A callback cannot connect an account to a user it was not
 *     issued for.
 *   - Every failure redirects to a page with a generic `?social_error=` code.
 *     Returning JSON here would leave the user staring at a raw payload, and
 *     returning the provider's message could reflect attacker-controlled text.
 *   - The authorization code never appears in a log or a redirect.
 *   - `state` is consumed even when the exchange later fails, so a captured
 *     callback URL cannot be replayed after a failed attempt.
 */

/** Where to send the user when we cannot recover a return path from state. */
const FALLBACK_RETURN = '/dashboard/settings';

function redirectWith(returnTo: string, params: Record<string, string>): NextResponse {
  const target = new URL(safeRedirectPath(returnTo, FALLBACK_RETURN), publicEnv.siteUrl);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return NextResponse.redirect(target.toString(), { status: 303 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  // The user declined, or Meta refused. Not an application error.
  if (providerError) {
    logger.info('social:oauth_declined', {
      // The reason is a fixed provider enum, safe to log; the description is
      // free text and is not.
      reason: url.searchParams.get('error_reason') ?? providerError,
    });
    return redirectWith(FALLBACK_RETURN, { social_error: 'declined' });
  }

  if (!state || !code) {
    return redirectWith(FALLBACK_RETURN, { social_error: 'invalid_callback' });
  }

  const db = supabaseAdmin();

  // Consume FIRST. Everything after this point runs at most once per state.
  const consumed = await consumeOAuthState(state, 'meta', db);
  if (!consumed) {
    // Unknown, expired, or already used — deliberately indistinguishable.
    return redirectWith(FALLBACK_RETURN, { social_error: 'state_rejected' });
  }

  const returnTo = consumed.returnTo ?? FALLBACK_RETURN;

  if (!isConfigured.metaOAuth()) {
    // Configuration was removed mid-flow. Better to say so than to store a
    // credential we cannot encrypt.
    return redirectWith(returnTo, { social_error: 'not_configured' });
  }

  try {
    const shortLived = await exchangeCodeForToken(code);
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);

    // What did we actually get? Meta grants scopes individually, and a user
    // can untick any of them on the consent screen.
    const inspection = await debugToken(longLived.access_token);
    const grantedScopes = inspection.data?.scopes ?? [];
    const metaUserId = inspection.data?.user_id ?? null;

    if (inspection.data?.is_valid === false) {
      return redirectWith(returnTo, { social_error: 'token_invalid' });
    }

    const expiresAt = resolveExpiry(longLived.expires_in, inspection.data?.expires_at);

    const pages = await listPages(longLived.access_token);

    if (pages.length === 0) {
      // A personal Facebook account with no Page cannot publish anything. Say
      // that rather than creating a connection that will fail on first use.
      return redirectWith(returnTo, { social_error: 'no_pages' });
    }

    const connected = await connectPages({
      pages,
      userId: consumed.userId,
      brandId: consumed.brandId,
      grantedScopes,
      expiresAt,
      metaUserId,
      db,
    });

    logger.info('social:oauth_completed', {
      userId: consumed.userId,
      brandId: consumed.brandId,
      pages: pages.length,
      connected: connected.total,
      instagram: connected.instagram,
    });

    return redirectWith(returnTo, {
      social_connected: String(connected.total),
      ...(connected.instagram === 0 ? { social_notice: 'no_instagram_business_account' } : {}),
    });
  } catch (error) {
    // The state is already consumed, so this cannot be retried with the same
    // URL — the user must start a fresh flow, which is correct.
    logger.error('social:oauth_exchange_failed', error, {
      userId: consumed.userId,
      brandId: consumed.brandId,
    });
    return redirectWith(returnTo, { social_error: 'exchange_failed' });
  }
}

/**
 * Resolves token expiry.
 *
 * `expires_in` from the exchange and `expires_at` from token inspection do not
 * always agree, and a long-lived user token can report `expires_at: 0`, which
 * means "does not expire". Taking the more conservative of the two available
 * answers means an account warns early rather than late.
 */
function resolveExpiry(expiresIn: number | undefined, expiresAt: number | undefined): Date | null {
  const candidates: number[] = [];

  if (typeof expiresIn === 'number' && expiresIn > 0) {
    candidates.push(Date.now() + expiresIn * 1000);
  }
  // 0 is Meta's "never expires" sentinel, not a 1970 timestamp.
  if (typeof expiresAt === 'number' && expiresAt > 0) {
    candidates.push(expiresAt * 1000);
  }

  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates));
}

/**
 * Stores one connection per publishable target.
 *
 * A Page is a Facebook target; a Page with a linked Instagram business account
 * is also an Instagram target, and the two are stored separately because they
 * have different ids, different scopes and different failure modes — but they
 * share the Page token, which is what Meta actually authenticates with.
 */
async function connectPages(input: {
  pages: MetaPage[];
  userId: string;
  brandId: string | null;
  grantedScopes: string[];
  expiresAt: Date | null;
  metaUserId: string | null;
  db: ReturnType<typeof supabaseAdmin>;
}): Promise<{ total: number; instagram: number }> {
  let total = 0;
  let instagram = 0;

  for (const page of input.pages) {
    // A Page the user cannot post to is not a publishing target. `tasks` is
    // absent on some responses, so its absence is not treated as a denial.
    const canPost = !page.tasks || page.tasks.includes('CREATE_CONTENT');

    if (canPost) {
      await upsertSocialAccount(
        {
          userId: input.userId,
          brandId: input.brandId,
          platform: 'facebook',
          accountName: page.name,
          externalAccountId: page.id,
          externalPageId: page.id,
          accessToken: page.access_token,
          grantedScopes: input.grantedScopes,
          tokenExpiresAt: input.expiresAt,
          metadata: { metaUserId: input.metaUserId, tasks: page.tasks ?? null },
        },
        input.db
      );
      total += 1;
    }

    const igAccount = page.instagram_business_account;
    if (igAccount?.id) {
      await upsertSocialAccount(
        {
          userId: input.userId,
          brandId: input.brandId,
          platform: 'instagram',
          accountName: igAccount.username ?? page.name,
          externalAccountId: igAccount.id,
          // Publishing to Instagram authenticates with the PAGE token.
          externalPageId: page.id,
          accessToken: page.access_token,
          grantedScopes: input.grantedScopes,
          tokenExpiresAt: input.expiresAt,
          metadata: { metaUserId: input.metaUserId, pageId: page.id, pageName: page.name },
        },
        input.db
      );
      total += 1;
      instagram += 1;
    }
  }

  return { total, instagram };
}
