/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SectionRenderer } from '@/components/website/SectionRenderer';
import { sectionContentSchema, type SectionContent } from '@/lib/website/schema';

/**
 * The site preview.
 *
 * Two things are worth asserting in a DOM: that every section kind the schema
 * accepts actually renders something (the old `/api/ai/generate-website`
 * returned an object nothing could display), and that the testimonials section
 * renders as an empty, labelled slot. A fabricated customer quote on a
 * published site is the worst output this product can produce, and the schema
 * already makes it impossible — this proves the renderer agrees.
 */

afterEach(() => cleanup());

/** One valid instance of each section kind, parsed so defaults are filled. */
const SAMPLES: SectionContent[] = [
  { kind: 'hero', headline: 'Barrier first' },
  { kind: 'features', items: [{ title: 'Ceramide complex', description: 'Three ceramides.' }] },
  { kind: 'about', body: 'We started in a kitchen.\n\nNow we are here.' },
  { kind: 'products', productIds: [] },
  { kind: 'testimonials' },
  { kind: 'pricing', tiers: [{ name: 'Starter', price: '$9', features: ['One brand'] }] },
  { kind: 'faq', items: [{ question: 'Is it vegan?', answer: 'Yes.' }] },
  { kind: 'cta', headline: 'Start today', cta: { label: 'Get started' } },
  { kind: 'contact', showForm: true },
  { kind: 'gallery', imagePrompts: ['a bottle on stone'] },
  { kind: 'footer', columns: [{ heading: 'Shop', links: [{ label: 'All products', href: '/products' }] }] },
].map((raw) => sectionContentSchema.parse(raw));

describe('SectionRenderer', () => {
  it('renders every section kind the schema accepts', () => {
    for (const content of SAMPLES) {
      const { container, unmount } = render(<SectionRenderer content={content} />);
      // "Renders something" means real content, not an empty fragment.
      expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      expect(container.querySelector('section, footer')).toBeTruthy();
      unmount();
    }
  });

  it('covers the whole union — a new kind would fail this list', () => {
    const rendered = new Set(SAMPLES.map((s) => s.kind));
    const accepted = new Set(sectionContentSchema.options.map((option) => option.shape.kind.value));
    expect(rendered).toEqual(accepted);
  });

  it('renders testimonials as empty slots carrying no quote', () => {
    const testimonials = sectionContentSchema.parse({ kind: 'testimonials', slots: 3 });
    const { container } = render(<SectionRenderer content={testimonials} />);

    // The advisory note explaining why the section is empty.
    expect(screen.getByRole('note')).toBeTruthy();
    // Exactly the requested number of slots, none of them containing text that
    // could be mistaken for a customer's words.
    const quoted = container.textContent ?? '';
    expect(quoted).not.toMatch(/["“][^"”]{20,}/);
    expect(screen.getAllByText(/your customer.s words go here/i)).toHaveLength(3);
  });

  it('shows the image prompt instead of a blank box', () => {
    const hero = sectionContentSchema.parse({
      kind: 'hero',
      headline: 'Barrier first',
      imagePrompt: 'a serum bottle on travertine',
    });
    render(<SectionRenderer content={hero} />);
    // The user needs to know what would be generated here.
    expect(screen.getByText(/a serum bottle on travertine/i)).toBeTruthy();
  });

  it('escapes generated copy rather than interpreting it as markup', () => {
    const hero = sectionContentSchema.parse({
      kind: 'hero',
      headline: '<img src=x onerror=alert(1)>',
    });
    const { container } = render(<SectionRenderer content={hero} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('splits an about body into paragraphs', () => {
    const about = sectionContentSchema.parse({ kind: 'about', body: 'First para.\n\nSecond para.' });
    const { container } = render(<SectionRenderer content={about} />);
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});
