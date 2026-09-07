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
 * Builds the CSP. In development Next needs 'unsafe-eval' for React Refresh;
 * production does not and must not get it.
 */
export function buildContentSecurityPolicy(nonce: string, isDev = process.env.NODE_ENV !== 'production'): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
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
