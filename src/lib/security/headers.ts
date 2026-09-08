/**
 * Security response headers.
 *
 * These were previously defined but imported by nothing, so production served
 * none of them. They are now applied in two places:
 *   - next.config.mjs `headers()` for every static and dynamic response
 *   - src/middleware.ts, which additionally injects a per-request CSP nonce
 *
 * CSP notes:
 *   - Next's App Router injects inline bootstrap scripts, so a nonce is
 *     required; 'strict-dynamic' then covers the chunks those scripts load.
 *   - `style-src` must allow 'unsafe-inline': Tailwind is compiled to a
 *     stylesheet, but next/font injects inline <style> and React inline style
 *     props are used throughout. Restricting styles gains little against the
 *     XSS classes CSP actually mitigates.
 *   - connect-src must reach Supabase (REST, auth, storage, realtime) and
 *     Paddle; frame-src must allow Paddle's checkout overlay.
 */

/**
 * DEPLOYMENT NOTE: NEXT_PUBLIC_* variables are inlined by Next at BUILD time,
 * so this origin is fixed when `next build` runs — changing the environment
 * variable on an already-built artifact will NOT change the CSP, and the
 * browser will then block Supabase requests with no visible error beyond a
 * console violation.
 *
 * Consequence: the production build must be produced with the production
 * NEXT_PUBLIC_SUPABASE_URL set. A single artifact cannot be promoted across
 * projects that use different Supabase instances.
 *
 * A wildcard (https://*.supabase.co) would remove that constraint, but it would
 * also let an XSS exfiltrate to any Supabase project, so the exact origin is
 * preferred.
 */
const SUPABASE_ORIGIN = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
})();

const SUPABASE_WS = SUPABASE_ORIGIN ? SUPABASE_ORIGIN.replace(/^https:/, 'wss:') : '';

/** Headers that are safe to serve on every response, static included. */
export const baseSecurityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
  // 2 years, preload-eligible. Only meaningful over HTTPS; harmless locally.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
};

/**
 * Builds the CSP.
 *
 * SCRIPT POLICY — why this is path-aware
 *
 * A nonce-based `script-src` with 'strict-dynamic' is the strongest option, but
 * Next can only stamp a nonce onto HTML it renders per-request. Statically
 * prerendered pages are built once, at build time, with no request and
 * therefore no nonce — and because 'strict-dynamic' makes the browser ignore
 * host allowlists and 'unsafe-inline', those pages' own bootstrap scripts get
 * blocked. The symptom is subtle and severe: the page renders its server HTML,
 * never hydrates, and any Suspense fallback stays on screen permanently.
 *
 * CSP3 also specifies that when a nonce is present, 'unsafe-inline' is ignored
 * for inline scripts — so "send both" is not a workaround.
 *
 * Resolution: choose per path.
 *   - /dashboard and /admin always render dynamically (they read the session
 *     cookie), so they get the full nonce + 'strict-dynamic' policy. This is
 *     where authenticated user data lives and where XSS would actually matter.
 *   - Marketing and auth pages are statically generated and get 'unsafe-inline'
 *     instead. Weaker for inline script injection, but every other directive
 *     still applies: no eval, object-src 'none', frame-ancestors 'none',
 *     base-uri 'self', form-action 'self', and a tight connect-src.
 *
 * Upgrade path (Phase 5): force dynamic rendering app-wide, or move to
 * per-build script hashes, and then apply the nonce policy everywhere.
 */
export function buildContentSecurityPolicy(
  nonce: string,
  options: { dynamicRoute?: boolean; isDev?: boolean } = {}
): string {
  const isDev = options.isDev ?? process.env.NODE_ENV !== 'production';
  const dynamicRoute = options.dynamicRoute ?? false;

  const scriptSrc = dynamicRoute
    ? [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        'https://cdn.paddle.com',
        'https://sandbox-cdn.paddle.com',
        isDev ? "'unsafe-eval'" : '',
      ].filter(Boolean)
    : [
        "'self'",
        // Required by Next's statically generated bootstrap scripts, which
        // cannot carry a nonce. See the note above.
        "'unsafe-inline'",
        'https://cdn.paddle.com',
        'https://sandbox-cdn.paddle.com',
        isDev ? "'unsafe-eval'" : '',
      ].filter(Boolean);

  const connectSrc = [
    "'self'",
    SUPABASE_ORIGIN,
    SUPABASE_WS,
    'https://*.paddle.com',
    'https://generativelanguage.googleapis.com',
  ].filter(Boolean);

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
    'img-src': ["'self'", 'data:', 'blob:', 'https://*.supabase.co', 'https://lh3.googleusercontent.com'],
    'connect-src': connectSrc,
    'frame-src': ["'self'", 'https://*.paddle.com'],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  };

  if (!isDev) directives['upgrade-insecure-requests'] = [];

  return Object.entries(directives)
    .map(([directive, values]) => (values.length ? `${directive} ${values.join(' ')}` : directive))
    .join('; ');
}

/** Cryptographically random, base64 nonce for one response. */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Applies the base headers to any Response and returns it. */
export function withSecurityHeaders<T extends Response>(response: T): T {
  for (const [key, value] of Object.entries(baseSecurityHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}
