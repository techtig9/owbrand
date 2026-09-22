import { describe, it, expect } from 'vitest';
import { generatedSiteSchema, sitePageSchema, sectionContentSchema } from '@/lib/website/schema';

/**
 * The website structure schema.
 *
 * The two properties that carry real weight:
 *   - Testimonials cannot be generated with content. The master command
 *     forbids fabricated testimonials, and a fake quote on a published site is
 *     the worst possible output, so the section is a flagged placeholder by
 *     construction rather than by convention.
 *   - Section content is a discriminated union, so a hero missing its headline
 *     is a validation failure rather than a runtime surprise in the renderer.
 */

const heroSection = { kind: 'hero' as const, headline: 'Barrier first' };

describe('sectionContentSchema', () => {
  it('accepts a hero with only a headline and fills the rest', () => {
    const parsed = sectionContentSchema.parse(heroSection);
    expect(parsed).toMatchObject({ kind: 'hero', headline: 'Barrier first', eyebrow: '', ctas: [] });
  });

  it('rejects a hero with no headline', () => {
    expect(() => sectionContentSchema.parse({ kind: 'hero' })).toThrow();
  });

  it('rejects an unknown section kind', () => {
    expect(() => sectionContentSchema.parse({ kind: 'newsletter_signup' })).toThrow();
  });

  it('requires at least one feature item', () => {
    expect(() => sectionContentSchema.parse({ kind: 'features', items: [] })).toThrow();
    expect(sectionContentSchema.parse({ kind: 'features', items: [{ title: 'One' }] })).toBeTruthy();
  });

  it('requires at least one pricing tier', () => {
    expect(() => sectionContentSchema.parse({ kind: 'pricing', tiers: [] })).toThrow();
  });

  it('requires at least one FAQ item', () => {
    expect(() => sectionContentSchema.parse({ kind: 'faq', items: [] })).toThrow();
  });
});

describe('testimonials are placeholders by construction', () => {
  it('defaults placeholder to true', () => {
    const parsed = sectionContentSchema.parse({ kind: 'testimonials' });
    expect(parsed).toMatchObject({ kind: 'testimonials', placeholder: true });
  });

  it('REFUSES placeholder: false — a testimonial section can never claim to be real', () => {
    // z.literal(true) means the only accepted value is true, so a generator
    // cannot mark fabricated quotes as genuine.
    expect(() => sectionContentSchema.parse({ kind: 'testimonials', placeholder: false })).toThrow();
  });

  it('carries a note telling the user to add real quotes', () => {
    const parsed = sectionContentSchema.parse({ kind: 'testimonials' }) as { note: string };
    expect(parsed.note.toLowerCase()).toContain('real customer');
  });

  it('has no field capable of holding a quote', () => {
    const parsed = sectionContentSchema.parse({ kind: 'testimonials' });
    // Only structural fields exist: slots, note, heading, placeholder.
    expect(Object.keys(parsed).sort()).toEqual(['heading', 'kind', 'note', 'placeholder', 'slots']);
  });
});

describe('sitePageSchema', () => {
  it('accepts a valid page', () => {
    const parsed = sitePageSchema.parse({ slug: 'home', title: 'Home', sections: [heroSection] });
    expect(parsed.isHome).toBe(false);
    expect(parsed.seo.title).toBe('');
  });

  it('requires at least one section', () => {
    expect(() => sitePageSchema.parse({ slug: 'home', title: 'Home', sections: [] })).toThrow();
  });

  it('normalises and validates the slug', () => {
    expect(sitePageSchema.parse({ slug: 'About-Us', title: 'x', sections: [heroSection] }).slug).toBe('about-us');
  });

  it('rejects a slug with invalid characters', () => {
    for (const slug of ['about us', 'about/us', 'about_us', '-about', 'about-']) {
      expect(() => sitePageSchema.parse({ slug, title: 'x', sections: [heroSection] }), slug).toThrow();
    }
  });
});

describe('generatedSiteSchema', () => {
  it('accepts a minimal single-page site', () => {
    const parsed = generatedSiteSchema.parse({
      siteName: 'Noor Skin',
      pages: [{ slug: 'home', title: 'Home', isHome: true, sections: [heroSection] }],
    });

    expect(parsed.pages).toHaveLength(1);
    expect(parsed.theme.mood).toBe('');
  });

  it('requires at least one page', () => {
    expect(() => generatedSiteSchema.parse({ siteName: 'X', pages: [] })).toThrow();
  });

  it('caps page count so a runaway generation cannot write hundreds', () => {
    const pages = Array.from({ length: 11 }, (_, i) => ({
      slug: `page-${i}`,
      title: `Page ${i}`,
      sections: [heroSection],
    }));
    expect(() => generatedSiteSchema.parse({ siteName: 'X', pages })).toThrow();
  });

  it('accepts a full multi-section page', () => {
    const parsed = generatedSiteSchema.parse({
      siteName: 'Noor Skin',
      pages: [
        {
          slug: 'home',
          title: 'Home',
          isHome: true,
          sections: [
            heroSection,
            { kind: 'features', items: [{ title: 'Barrier first', description: 'x' }] },
            { kind: 'testimonials' },
            { kind: 'faq', items: [{ question: 'Q?', answer: 'A.' }] },
            { kind: 'cta', headline: 'Start', cta: { label: 'Shop' } },
            { kind: 'footer' },
          ],
        },
      ],
      theme: { primaryColor: '#C8785A', mood: 'calm' },
    });

    expect(parsed.pages[0].sections).toHaveLength(6);
    expect(parsed.theme.primaryColor).toBe('#C8785A');
  });

  it('fills every default so the renderer never sees undefined', () => {
    const parsed = generatedSiteSchema.parse({
      siteName: 'X',
      pages: [{ slug: 'home', title: 'Home', sections: [heroSection] }],
    });

    const json = JSON.stringify(parsed);
    expect(json).not.toContain('undefined');
    expect(parsed.pages[0].seo).toBeDefined();
    expect(parsed.pages[0].isHome).toBe(false);
  });
});
