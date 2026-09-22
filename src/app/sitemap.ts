import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';
import { PUBLIC_ROUTES, canonicalUrl } from '@/lib/marketing/site-map';

/**
 * The sitemap is generated from PUBLIC_ROUTES, the same list robots.ts reads,
 * so the two cannot contradict each other.
 *
 * `lastModified` is the build time rather than a hand-maintained date. A date
 * that is edited by hand is wrong within a week, and a sitemap that claims
 * every page changed today is a signal crawlers learn to discount.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const builtAt = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: canonicalUrl(publicEnv.siteUrl, route.path),
    lastModified: builtAt,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
