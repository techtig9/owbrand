import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/security/redirect';
import { checkRateLimit, clientIp } from '@/lib/security/rate-limit';
import { logger, newRequestId } from '@/lib/logger';
import { sendAuthEventNotification } from '@/lib/email/notifications';

/**
 * OAuth / email-link callback.
 *
 * Fixed in Phase 1:
 *  - The exchange result is now checked. Previously the error was discarded and
 *    the user was redirected to /dashboard regardless, where middleware bounced
 *    them straight back to /login with no explanation. That is the "Continue
 *    with Google does nothing" symptom.
 *  - `next` is validated through safeRedirectPath. Previously `?next=//evil.com`
 *    produced a post-authentication open redirect to an attacker's origin.
 *  - Provider-reported errors (user cancelled, consent denied) are surfaced.
 *  - The endpoint is rate limited per IP.
 */
export async function GET(req: NextRequest) {
  const requestId = newRequestId();
  const params = req.nextUrl.searchParams;
  const next = safeRedirectPath(params.get('next'));

  const fail = (code: string, status?: number) => {
    const url = new URL('/login', req.url);
    url.searchParams.set('error', code);
    if (next !== '/dashboard') url.searchParams.set('next', next);
    logger.warn('auth_callback:failed', { requestId, code, status, route: '/auth/callback' });
    return NextResponse.redirect(url);
  };

  const rate = await checkRateLimit('authCallback', clientIp(req));
  if (!rate.allowed) return fail('oauth_failed');

  // The provider can redirect back with an error instead of a code.
  const providerError = params.get('error');
  if (providerError) {
    const description = params.get('error_description') ?? '';
    logger.warn('auth_callback:provider_error', {
      requestId,
      providerError,
      // Provider text is logged but never reflected into the redirect.
      description: description.slice(0, 200),
    });
    return fail(providerError === 'access_denied' ? 'oauth_denied' : 'provider_error');
  }

  const code = params.get('code');
  if (!code) return fail('missing_code');

  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.session || !data.user) {
    logger.warn('auth_callback:exchange_failed', {
      requestId,
      reason: error?.message?.slice(0, 200),
      status: error?.status,
    });
    return fail('exchange_failed', error?.status);
  }

  logger.info('auth_callback:success', {
    requestId,
    userId: data.user.id,
    provider: data.user.app_metadata?.provider,
  });

  // Best-effort notification. Awaited so the write completes before the
  // serverless invocation is frozen, but any failure is swallowed: a mail
  // problem must never turn a successful login into a failed one.
  try {
    await sendAuthEventNotification({
      userId: data.user.id,
      email: data.user.email ?? '',
      name: (data.user.user_metadata?.full_name as string | undefined) ?? null,
      method: (data.user.app_metadata?.provider as string | undefined) ?? 'oauth',
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
  } catch (err) {
    logger.error('auth_callback:notification_failed', err, { requestId });
  }

  return NextResponse.redirect(new URL(next, req.url));
}
