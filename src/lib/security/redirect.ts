/**
 * Open-redirect protection.
 *
 * The OAuth callback previously did `NextResponse.redirect(new URL(next, req.url))`
 * with `next` straight off the query string. `?next=//evil.com` resolves to
 * `https://evil.com`, so an attacker could bounce a freshly-authenticated user
 * off our own domain — the classic post-auth open redirect used to make
 * phishing pages look legitimate.
 *
 * Rule: only same-origin, absolute-path destinations are ever honoured, and
 * anything else silently degrades to a safe default.
 */

/** Where users land when no valid destination was supplied. */
export const DEFAULT_REDIRECT = '/dashboard';

/**
 * Normalises an untrusted `next`/`redirect` value into a safe relative path.
 *
 * Accepts: `/dashboard`, `/dashboard/brand-brain?tab=voice#top`
 * Rejects: absolute URLs, protocol-relative (`//host`), backslash variants
 *          (`/\host`, browsers normalise these to `//host`), scheme-relative
 *          tricks, control characters, and anything not starting with `/`.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback: string = DEFAULT_REDIRECT): string {
  if (!raw) return fallback;

  // Strip control characters and whitespace that browsers ignore but parsers
  // do not — `/\tjavascript:` and `/\n/evil.com` style bypasses.
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/[\u0000-\u0020\u007f]/g, '');
  if (value === '') return fallback;

  // Must be an absolute path on this origin.
  if (!value.startsWith('/')) return fallback;

  // Protocol-relative in either slash direction.
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;

  // A scheme anywhere before the first slash-delimited segment.
  if (/^\/[^/]*:/.test(value)) return fallback;

  // Backslashes are normalised to forward slashes by several browsers.
  if (value.includes('\\')) return fallback;

  return value;
}

/**
 * Builds an absolute URL for a redirect response, guaranteeing the destination
 * stays on `origin`.
 */
export function safeRedirectUrl(
  raw: string | null | undefined,
  origin: string | URL,
  fallback: string = DEFAULT_REDIRECT
): URL {
  const path = safeRedirectPath(raw, fallback);
  const base = typeof origin === 'string' ? new URL(origin) : origin;
  const url = new URL(path, base);

  // Belt and braces: if anything above let a cross-origin value through, drop
  // it here rather than emitting the redirect.
  if (url.origin !== base.origin) return new URL(fallback, base);

  return url;
}
