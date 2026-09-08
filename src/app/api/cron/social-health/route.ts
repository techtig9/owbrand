import { NextResponse } from 'next/server';
import { refreshSocialAccounts } from '@/lib/social/account-refresh';
import { secretsMatch } from '@/lib/crypto/secret-box';
import { serverEnv, isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

/**
 * Connection health check.
 *
 * Meant to run daily. Publishing runs every minute and must stay fast, so
 * token inspection — one Graph round trip per account — lives here instead of
 * being folded into it.
 *
 * Same authorization as /api/cron/publish: a constant-time shared-secret
 * comparison, refusing everything when CRON_SECRET is unset, and 404 rather
 * than 401 so the endpoint's existence is not advertised.
 */
async function handle(request: Request): Promise<NextResponse> {
  const expected = serverEnv.cronSecret;

  if (!expected) {
    return NextResponse.json(
      { error: 'The connection health job is not configured. Set CRON_SECRET.', code: 'not_configured' },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const provided = bearer ?? request.headers.get('x-cron-secret');

  if (!secretsMatch(provided, expected)) {
    logger.warn('cron:social_health_unauthorized', { hasAuthHeader: Boolean(authHeader) });
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  if (!isConfigured.metaOAuth()) {
    // Not an error: there is genuinely nothing to check on a server with no
    // social credentials configured.
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Meta OAuth is not configured on this server.',
      checked: 0,
    });
  }

  const startedAt = Date.now();

  try {
    const result = await refreshSocialAccounts();

    return NextResponse.json({
      ok: true,
      checked: result.checked,
      refreshed: result.refreshed,
      needsReconnect: result.needsReconnect,
      errors: result.errors,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error('cron:social_health_failed', error);
    return NextResponse.json({ ok: false, error: 'The connection health run failed.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
