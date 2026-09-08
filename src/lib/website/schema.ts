/**
 * Website structure schema.
 *
 * `/api/ai/generate-website` previously returned JSON that was never stored, so
 * nothing could render it, edit it, or export it — which is why the ZIP export
 * shipped a README and an empty package.json. This schema is what the generator
 * must produce and what the builder persists into site_pages / site_sections.
 *
 * Section content is intentionally a discriminated union: a hero and a pricing
 * table have genuinely different fields, and a single loose `content: object`
 * would push that difference into the renderer as runtime guesswork.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

export const sectionKinds = [
  'hero',
  'features',
  'about',
  'products',
  'testimonials',
  'pricing',
  'faq',
  'cta',
  'contact',
  'gallery',
  'footer',
] as const;

export type SectionKind = (typeof sectionKinds)[number];

/* ------------------------------------------------------------------ *
 * Section content
 * ------------------------------------------------------------------ */

const ctaSchema = z.object({
  label: text(60),
  href: text(300).default('#'),
  style: z.enum(['primary', 'secondary', 'ghost']).default('primary'),
});

const heroContent = z.object({
  kind: z.literal('hero'),
  eyebrow: text(80).default(''),
  headline: text(200),
  subheadline: text(500).default(''),
  ctas: z.array(ctaSchema).max(2).default([]),
  imagePrompt: text(400).default(''),
});

const featureItem = z.object({
  title: text(120),
  description: text(400).default(''),
  icon: text(40).default(''),
});

const featuresContent = z.object({
  kind: z.literal('features'),
  heading: text(200).default(''),
  subheading: text(400).default(''),
  items: z.array(featureItem).min(1).max(9),
});

const aboutContent = z.object({
  kind: z.literal('about'),
  heading: text(200).default(''),
  body: text(3000),
  imagePrompt: text(400).default(''),
});

const productsContent = z.object({
  kind: z.literal('products'),
  heading: text(200).default(''),
  subheading: text(400).default(''),
  /** Empty means "render whatever products exist" rather than hard-coding any. */
  productIds: z.array(z.string().uuid()).max(24).default([]),
});

/**
 * Testimonials carry an explicit `placeholder` flag.
 *
 * The master command forbids fabricated testimonials. A generated site still
 * needs a testimonial SLOT, so the generator produces the layout with the flag
 * set and the renderer refuses to publish a flagged block — rather than a fake
 * quote that reads as real.
 */
const testimonialsContent = z.object({
  kind: z.literal('testimonials'),
  heading: text(200).default(''),
  placeholder: z.literal(true).default(true),
  note: text(300).default('Add real customer quotes before publishing this section.'),
  slots: z.number().int().min(1).max(6).default(3),
});

const pricingTier = z.object({
  name: text(60),
  price: text(40).default(''),
  cadence: text(30).default(''),
  description: text(300).default(''),
  features: z.array(text(160)).max(12).default([]),
  highlighted: z.boolean().default(false),
  cta: ctaSchema.optional(),
});

const pricingContent = z.object({
  kind: z.literal('pricing'),
  heading: text(200).default(''),
  subheading: text(400).default(''),
  tiers: z.array(pricingTier).min(1).max(4),
});

const faqContent = z.object({
  kind: z.literal('faq'),
  heading: text(200).default(''),
  items: z
    .array(z.object({ question: text(300), answer: text(1500) }))
    .min(1)
    .max(12),
});

const ctaContent = z.object({
  kind: z.literal('cta'),
  headline: text(200),
  body: text(500).default(''),
  cta: ctaSchema,
});

const contactContent = z.object({
  kind: z.literal('contact'),
  heading: text(200).default(''),
  body: text(500).default(''),
  /** Never invented: filled from the workspace's own settings. */
  showForm: z.boolean().default(true),
});

const galleryContent = z.object({
  kind: z.literal('gallery'),
  heading: text(200).default(''),
  imagePrompts: z.array(text(400)).max(12).default([]),
});

const footerContent = z.object({
  kind: z.literal('footer'),
  tagline: text(200).default(''),
  columns: z
    .array(
      z.object({
        heading: text(60),
        links: z.array(z.object({ label: text(60), href: text(300) })).max(8),
      })
    )
    .max(4)
    .default([]),
});

export const sectionContentSchema = z.discriminatedUnion('kind', [
  heroContent,
  featuresContent,
  aboutContent,
  productsContent,
  testimonialsContent,
  pricingContent,
  faqContent,
  ctaContent,
  contactContent,
  galleryContent,
  footerContent,
]);

export type SectionContent = z.infer<typeof sectionContentSchema>;

/* ------------------------------------------------------------------ *
 * Pages and site
 * ------------------------------------------------------------------ */

export const seoSchema = z.object({
  title: text(70).default(''),
  description: text(180).default(''),
  ogTitle: text(70).default(''),
  ogDescription: text(180).default(''),
  keywords: z.array(text(40)).max(15).default([]),
});

export const sitePageSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by hyphens')
    .max(80),
  title: text(120),
  isHome: z.boolean().default(false),
  seo: seoSchema.default({ title: '', description: '', ogTitle: '', ogDescription: '', keywords: [] }),
  sections: z.array(sectionContentSchema).min(1).max(20),
});

export const generatedSiteSchema = z.object({
  siteName: text(120),
  pages: z.array(sitePageSchema).min(1).max(10),
  theme: z
    .object({
      primaryColor: text(20).default(''),
      accentColor: text(20).default(''),
      headingFont: text(60).default(''),
      bodyFont: text(60).default(''),
      /** minimal | editorial | bold | technical … */
      mood: text(40).default(''),
    })
    .default({ primaryColor: '', accentColor: '', headingFont: '', bodyFont: '', mood: '' }),
});

export type GeneratedSite = z.infer<typeof generatedSiteSchema>;
export type SitePage = z.infer<typeof sitePageSchema>;

/**
 * JSON Schema for constrained decoding.
 *
 * Kept loose on purpose. The discriminated union above is strict enough that a
 * fully-specified JSON Schema would frequently make the provider reject the
 * request outright, where our repair-and-retry ladder would have salvaged a
 * near-miss. Zod stays the real gate.
 */
export const generatedSiteJsonSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['siteName', 'pages'],
  properties: {
    siteName: { type: 'string' },
    theme: { type: 'object', additionalProperties: true },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['slug', 'title', 'sections'],
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          isHome: { type: 'boolean' },
          seo: { type: 'object', additionalProperties: true },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['kind'],
              properties: { kind: { type: 'string', enum: [...sectionKinds] } },
            },
          },
        },
      },
    },
  },
} as const;
