import { describe, expect, it } from 'vitest';
import { brandBrainSchema } from '@/lib/brand/schema';
import {
  cssTokens,
  tailwindFragment,
  scssVariables,
  paletteHtml,
  voiceGuide,
  kitReadme,
} from '@/lib/brand/kit';

/**
 * These files are handed to a customer's designer or developer. A broken
 * Tailwind fragment or an unreadable swatch sheet is visible to someone
 * outside the account, which makes it a different class of bug from a
 * dashboard glitch.
 */

const BRAIN = brandBrainSchema.parse({
  name: 'Kiln',
  tagline: 'Hand-thrown tableware',
  positioning: { usp: 'Small-batch ceramics' },
  voice: {
    voice: 'Warm and plain',
    tone: ['warm'],
    preferredWords: ['hand-thrown'],
    avoidedWords: ['utilise'],
    writingRules: ['Keep sentences under 20 words.'],
    exampleCopy: 'Every piece comes out of the kiln a little different.',
  },
  guidelines: { doRules: ['Show the maker'], dontRules: ['Never name competitors'] },
  visualIdentity: {
    colors: [
      { name: 'Clay', hex: '#C8785A', role: 'primary' },
      { name: 'Chalk', hex: '#F5F2ED', role: 'surface' },
    ],
    fonts: { heading: 'Fraunces', body: 'Inter', accent: '' },
  },
});

const BARE = brandBrainSchema.parse({ name: 'Bare', tagline: '', positioning: { usp: 'u' } });

describe('CSS tokens', () => {
  it('emits a custom property per colour, named by role', () => {
    const css = cssTokens(BRAIN);
    expect(css).toContain('--color-primary: #C8785A;');
    expect(css).toContain('--color-surface: #F5F2ED;');
  });

  it('quotes font names so a multi-word family does not break the declaration', () => {
    const brain = brandBrainSchema.parse({
      name: 'X',
      tagline: '',
      positioning: { usp: 'u' },
      visualIdentity: { fonts: { heading: 'PP Neue Montreal', body: 'Inter', accent: '' } },
    });
    // Unquoted, `--font-heading: PP Neue Montreal` is still valid CSS but
    // every consumer has to re-quote it. Quoting here is what makes the
    // token paste-able.
    expect(cssTokens(brain)).toContain('--font-heading: "PP Neue Montreal";');
  });

  it('produces valid, balanced CSS even with nothing defined', () => {
    const css = cssTokens(BARE);
    expect(css).toContain(':root {');
    expect(css.trim().endsWith('}')).toBe(true);
    // Not the string "undefined", which is the classic failure of a generated
    // stylesheet built from optional fields.
    expect(css).not.toContain('undefined');
  });
});

describe('the Tailwind fragment', () => {
  it('extends the theme rather than replacing it', () => {
    // Replacing `theme.colors` removes Tailwind's own palette, and the first
    // thing that breaks is every `text-gray-500` already in the project.
    const config = tailwindFragment(BRAIN);
    expect(config).toContain('extend:');
    expect(config).toMatch(/extend:[\s\S]*colors:/);
  });

  it('is syntactically valid JavaScript', () => {
    // The decisive test. A fragment that does not parse is worse than no
    // fragment: it breaks the project it is pasted into.
    const config = tailwindFragment(BRAIN);
    expect(() => new Function(`const module = {}; ${config}; return module.exports;`)).not.toThrow();

    const exported = new Function(`const module = {}; ${config}; return module.exports;`)();
    expect(exported.theme.extend.colors.primary).toBe('#C8785A');
    expect(exported.theme.extend.fontFamily.heading).toEqual(['Fraunces', 'sans-serif']);
  });

  it('still parses with no palette at all', () => {
    const config = tailwindFragment(BARE);
    expect(() => new Function(`const module = {}; ${config}; return module.exports;`)).not.toThrow();
  });
});

describe('SCSS variables', () => {
  it('names variables by role', () => {
    expect(scssVariables(BRAIN)).toContain('$primary: #C8785A;');
  });

  it('falls back to an index when a colour has no role', () => {
    const brain = brandBrainSchema.parse({
      name: 'X',
      tagline: '',
      positioning: { usp: 'u' },
      visualIdentity: { colors: [{ name: 'One', hex: '#123456', role: '' }] },
    });
    expect(scssVariables(brain)).toContain('$brand-1: #123456;');
  });
});

describe('the palette sheet', () => {
  it('is a self-contained document with no external references', () => {
    const html = paletteHtml(BRAIN);
    expect(html).toMatch(/^<!doctype html>/i);
    // A swatch sheet that needs a network or a build step is one nobody
    // opens. It has to work from a USB stick.
    expect(html).not.toMatch(/<script|<link[^>]+href=["']http|src=["']http/i);
  });

  it('picks readable text for a pale colour', () => {
    // #F5F2ED is nearly white. White text on it would be invisible, which is
    // the whole reason luminance is measured rather than guessed.
    const html = paletteHtml(BRAIN);
    expect(html).toContain('background:#F5F2ED;color:#111111');
    expect(html).toContain('background:#C8785A;color:#ffffff');
  });

  it('handles a three-digit hex', () => {
    const brain = brandBrainSchema.parse({
      name: 'X',
      tagline: '',
      positioning: { usp: 'u' },
      visualIdentity: { colors: [{ name: 'W', hex: '#fff', role: 'bg' }] },
    });
    // Expanding #fff to #ffffff matters: parsing 'ff' as the full channel
    // would read it as near-black and choose white text on white.
    expect(paletteHtml(brain)).toContain('color:#111111');
  });
});

describe('the voice guide', () => {
  it('states that the avoid list is enforced, not advisory', () => {
    const guide = voiceGuide(BRAIN);
    expect(guide).toContain('utilise');
    expect(guide).toMatch(/flagged as a blocker/i);
  });

  it('names what is NOT defined rather than omitting the section', () => {
    // A missing section reads as "this brand has no rules about that". Saying
    // it is undefined tells a writer there is a decision still to make.
    const guide = voiceGuide(BARE);
    expect(guide).toMatch(/Not defined yet/);
    expect(guide).toMatch(/an avoid list/);
  });

  it('does not claim gaps when there are none', () => {
    expect(voiceGuide(BRAIN)).not.toMatch(/Not defined yet/);
  });
});

describe('the README', () => {
  it('carries attribution on the free plan only', () => {
    expect(kitReadme(BRAIN, '\n---\nMade with owbrand\n')).toContain('Made with owbrand');
    expect(kitReadme(BRAIN, '')).not.toContain('Made with owbrand');
  });

  it('mentions the logo folder only when a logo was included', () => {
    // Listing a folder that is not in the archive sends someone looking for a
    // file that does not exist.
    expect(kitReadme(BRAIN, '', true)).toContain('logo/');
    expect(kitReadme(BRAIN, '', false)).not.toContain('| `logo/`');
  });

  it('tells the reader to edit the brand rather than these files', () => {
    expect(kitReadme(BRAIN, '')).toMatch(/overwritten by the next export/i);
  });
});
