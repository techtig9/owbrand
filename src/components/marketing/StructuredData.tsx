import { PLANS } from '@/lib/plans';
import { FAQS } from '@/lib/marketing/faq';

/**
 * JSON-LD for the landing page.
 *
 * Emitted as `application/ld+json`, which needs no CSP nonce: a `<script>`
 * with a non-JavaScript type is never evaluated, so it is data rather than
 * executable script.
 *
 * Two rules this follows, both of which are Google structured-data policy and
 * not merely style:
 *
 *  1. **Every value is derived, never restated.** The FAQ entries come from
 *     `lib/marketing/faq.ts` — the same array the visible accordion renders —
 *     and the offers come from `lib/plans.ts`, the same source the pricing
 *     table uses. Structured data that disagrees with the visible page is a
 *     violation, and hand-copied duplicates are exactly how that happens.
 *  2. **No `aggregateRating` and no `review`.** Ratings are the most tempting
 *     field here and there are no real reviews to aggregate. Inventing one
 *     fabricates a trust signal, which the operating rules forbid outright —
 *     and it is also the field Google issues manual actions over.
 */
export function StructuredData({ siteUrl }: { siteUrl: string }) {
  const base = siteUrl.replace(/\/$/, '');
  const paidPlans = Object.values(PLANS).filter((plan) => plan.priceMonthly > 0);

  const graph = [
    {
      '@type': 'SoftwareApplication',
      '@id': `${base}/#software`,
      name: 'OwBrand',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: `${base}/`,
      description:
        'Builds a reusable Brand Brain from one business description, then generates on-brand websites, posts and creative from it — with a factuality guard that blocks claims no approved product fact supports.',
      offers: [
        { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
        ...paidPlans.map((plan) => ({
          '@type': 'Offer',
          name: plan.label,
          price: String(plan.priceMonthly),
          priceCurrency: 'USD',
          // Stated explicitly: an Offer with no period reads as a one-off
          // purchase, which would misrepresent a subscription.
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: String(plan.priceMonthly),
            priceCurrency: 'USD',
            billingDuration: 1,
            billingIncrement: 1,
            unitCode: 'MON',
          },
        })),
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${base}/#faq`,
      mainEntity: FAQS.map((entry) => ({
        '@type': 'Question',
        name: entry.question,
        acceptedAnswer: { '@type': 'Answer', text: entry.answer },
      })),
    },
    {
      '@type': 'Organization',
      '@id': `${base}/#organization`,
      name: 'Techtig',
      url: `${base}/`,
    },
  ];

  return (
    <script
      type="application/ld+json"
      // Data, not code: the type attribute stops the browser evaluating it, and
      // the payload is serialised from typed objects rather than concatenated
      // strings, so there is no injection surface.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }),
      }}
    />
  );
}
