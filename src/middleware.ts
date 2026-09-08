import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, generateCspNonce, baseSecurityHeaders } from '@/lib/security/headers';
import {
  isAuthOnlyPath,
  isProtectedPath,
  unconfiguredDeploymentAction,
} from '@/lib/security/deployment-guard';
import { isConfigured } from '@/lib/env';

/**
 * Session refresh, route protection, and per-request CSP.
 *
 * The matcher covers the whole app (not just /dashboard) so that the CSP nonce
 * and security headers reach marketing and auth pages too. Auth work is scoped
 * to the routes that need it.
 */

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Only routes that always render per-request can carry a nonce; see the note
  // in lib/security/headers.ts. /dashboard and /admin read the session cookie,
  // so they are always dynamic.
  const dynamicRoute = path.startsWith('/dashboard') || path.startsWith('/admin');

  const nonce = generateCspNonce();
  const csp = buildContentSecurityPolicy(nonce, { dynamicRoute });

  // Forward the nonce so the App Router can attach it to its bootstrap scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  /*
   * Missing Supabase credentials used to take the whole deployment down:
   * createServerClient() throws on an empty URL, and it ran below on every
   * matched request. Degrade deliberately instead — public pages render so an
   * operator can read /api/ready, gated pages refuse. See
   * lib/security/deployment-guard.ts.
   */
  if (!isConfigured.supabase()) {
    if (unconfiguredDeploymentAction(path) === 'refuse') {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'not_configured');
      return applyHeaders(NextResponse.redirect(redirectUrl), csp);
    }
    return applyHeaders(response, csp);
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Recreating the response preserves the refreshed auth cookie.
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.cookies.set({
            name,
            value,
            ...options,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          });
        },
        remove(name: string, options: CookieOptions) {
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.cookies.set({
            name,
            value: '',
            ...options,
            maxAge: 0,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          });
        },
      },
    }
  );

  const needsAuth = isProtectedPath(path);
  const isAuthPage = isAuthOnlyPath(path);

  // Only touch Supabase when the answer can change what we return. Marketing
  // pages and static assets skip the round-trip entirely.
  if (needsAuth || isAuthPage) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (needsAuth && !user) {
      const redirectUrl = new URL('/login', request.url);
      // Preserve the deep link; /login validates it via safeRedirectPath.
      redirectUrl.searchParams.set('next', path + request.nextUrl.search);
      return applyHeaders(NextResponse.redirect(redirectUrl), csp);
    }

    if (isAuthPage && user) {
      return applyHeaders(NextResponse.redirect(new URL('/dashboard', request.url)), csp);
    }

    if (path.startsWith('/admin') && user) {
      // Read through the user's own session (RLS-scoped), never service-role.
      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
      if (profile?.role !== 'admin') {
        return applyHeaders(NextResponse.redirect(new URL('/dashboard', request.url)), csp);
      }
    }
  }

  return applyHeaders(response, csp);
}

function applyHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  for (const [key, value] of Object.entries(baseSecurityHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Every path except Next's own static output and common asset files.
     * Keeping marketing pages in scope means they get CSP too.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
