import { NextResponse } from 'next/server';
import { z } from 'zod';
import { routeHandler, ApiError } from '@/lib/api/errors';
import { parseSearchParams, uuidSchema, boundedText } from '@/lib/api/validate';
import { requireUser, assertBrandAccess } from '@/lib/auth/guards';
import { enforceRateLimit } from '@/lib/security/rate-limit';
import { createOAuthState } from '@/lib/social/oauth-state';
import { metaAuthorizationUrl } from '@/lib/social/providers/meta-client';
import { scopesForProvider } from '@/lib/social/platforms';
import { isConfigured } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Begins a social OAuth flow.
 *
 * The whole flow is server-driven, which is the point. The previous design had
 * the browser obtain an `oauthCode` however it liked and POST it to
 * /api/social/connect-account — so the server never issued the request it was
 * accepting an answer to, and had no way to tell a genuine redirect from a
 * code an attacker had obtained elsewhere.
 *
 * Here the server:
 *   - authenticates the caller and authorizes the brand,
 *   - mints a single-use state row tied to that user,
 *   - fixes the redirect_uri itself,
 *   - and hands back the provider URL.
 *
 * The client's only job is to follow the redirect.
 */
const Query = z.object({
  provider: z.literal('meta').default('meta'),
  brandId: uuidSchema.optional(),
  /** Where to return the user. Validated as a local path when the state is stored. */
  returnTo: boundedText(0, 300).optional(),
});

export const GET = routeHandler('/api/social/oauth/start', async (request: Request) => {
  const user = await requireUser();
  // Same budget as auth: starting an OAuth flow writes a row, so it is worth
  // a tighter limit than a normal read.
  await enforceRateLimit('auth', user.id);

  const query = parseSearchParams(request, Query);

  if (!isConfigured.metaOAuth()) {
    // Honest and specific: an operator reading this knows exactly what to set.
    throw ApiError.notConfigured(
      'Social publishing is not configured on this server. META_APP_ID, META_APP_SECRET and TOKEN_ENCRYPTION_KEY must all be set.'
    );
  }

  const db = supabaseAdmin();

  // A connection can be scoped to a brand. If one is named, the caller must
  // have access to it — otherwise a user could attach their own social account
  // to somebody else's brand and publish under it.
  if (query.brandId) {
    await assertBrandAccess(user.id, query.brandId, { db });
  }

  const scopes = scopesForProvider('meta');

  const state = await createOAuthState(
    {
      userId: user.id,
      brandId: query.brandId ?? null,
      provider: 'meta',
      requestedScopes: scopes,
      returnTo: query.returnTo ?? '/dashboard/settings',
    },
    db
  );

  const authorizationUrl = metaAuthorizationUrl(state, scopes);

  logger.info('social:oauth_started', { userId: user.id, provider: 'meta', brandId: query.brandId ?? null });

  // Returned as JSON rather than a 302 so the caller can be a fetch from the
  // connections screen. The URL contains no secret — state is single-use and
  // bound to this user.
  return NextResponse.json({ authorizationUrl, provider: 'meta', scopes });
});
