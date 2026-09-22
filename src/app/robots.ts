import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';
import { DISALLOWED_PATHS, canonicalUrl } from '@/lib/marketing/site-map';

/**
 * robots.txt, generated rather than a static file in public/.
 *
 * Generated because the sitemap URL has to be absolute and therefore depends on
 * NEXT_PUBLIC_SITE_URL. A committed static file would have to hard-code one
 * origin, and would then point every preview deployment's crawler at
 * production's sitemap.
 *
 * `/login` and `/signup` are disallowed even though they are public: they carry
 * nothing worth ranking, and `/login?next=…` generates unbounded URLs that all
 * render the same page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: DISALLOWED_PATHS }],
    sitemap: canonicalUrl(publicEnv.siteUrl, '/sitemap.xml'),
    host: publicEnv.siteUrl.replace(/\/$/, ''),
  };
}
