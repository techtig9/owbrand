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
  /**
   * Whether the page belongs in the sitemap.
   *
   * `false` for pages that are publicly reachable and linked but should not be
   * indexed — currently the legal drafts, which set
   * `robots: { index: false }` in their own metadata.
   *
   * Listing a noindex URL in a sitemap is what produces Search Console's
   * "Indexed, though blocked by robots.txt" class of warning: the sitemap says
   * "please index this" and the page says "do not". They must agree, and this
   * flag is what makes the list usable for both the sitemap and the footer's
   * link check without them contradicting each other.
   */
  index: boolean;
}

export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly', index: true },
  { path: '/changelog', priority: 0.6, changeFrequency: 'weekly', index: true },
  { path: '/blog', priority: 0.6, changeFrequency: 'weekly', index: true },
  { path: '/docs/api', priority: 0.5, changeFrequency: 'monthly', index: true },
  { path: '/help', priority: 0.7, changeFrequency: 'monthly', index: true },
  { path: '/contact', priority: 0.4, changeFrequency: 'yearly', index: true },

  // Legal pages are linked from the footer and must stay in this list so the
  // footer's consistency check can see them — but they are unreviewed drafts,
  // so they are not advertised for indexing. An unreviewed privacy policy that
  // ranks is worse than one nobody can find. Flip these to true once a lawyer
  // has signed them off and the draft notice comes off the page component.
  { path: '/legal/privacy', priority: 0.3, changeFrequency: 'yearly', index: false },
  { path: '/legal/terms', priority: 0.3, changeFrequency: 'yearly', index: false },
  { path: '/legal/refund', priority: 0.3, changeFrequency: 'yearly', index: false },
  { path: '/legal/subprocessors', priority: 0.2, changeFrequency: 'yearly', index: false },
  { path: '/legal/ai-use', priority: 0.3, changeFrequency: 'yearly', index: false },
];

/** The subset the sitemap advertises. */
export const INDEXABLE_ROUTES = PUBLIC_ROUTES.filter((route) => route.index);

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
