/**
 * One list of the public, indexable routes.
 *
 * `sitemap.ts`, `robots.ts` and the canonical URLs all read from here so they
 * cannot disagree. Three separate hard-coded lists is how a sitemap ends up
 * advertising a page that `robots.txt` disallows — Search Console reports it as
 * "Indexed, though blocked", and it is entirely self-inflicted.
 *
 * Adding a public page means adding it here. Anything absent is simply not
 * advertised, which is the safe default: the cost of omitting a page from a
 * sitemap is slower discovery, while the cost of listing a private one is
 * leaking its existence.
 */

export interface PublicRoute {
  path: string;
  /** Relative to the others, not absolute. Google treats it as a weak hint. */
  priority: number;
  changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' },
  { path: '/changelog', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/blog', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/legal/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/legal/terms', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/legal/refund', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/legal/subprocessors', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/legal/ai-use', priority: 0.3, changeFrequency: 'yearly' },
];

/**
 * Paths that must never be crawled, in `robots.txt` Disallow form.
 *
 * `/login` and `/signup` are here on purpose even though they are public. They
 * carry no content worth ranking, and `/login?next=…` generates an unbounded
 * set of URLs that all render the same page — which is duplicate content that
 * dilutes the pages that do matter.
 */
export const DISALLOWED_PATHS = [
  '/api/',
  '/dashboard',
  '/admin',
  '/auth/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
];

/** Absolute canonical URL for a path. Trailing slashes are normalised away. */
export function canonicalUrl(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  return `${base}/${path.replace(/^\/+|\/+$/g, '')}`;
}
