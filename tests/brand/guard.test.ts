import { describe, it, expect } from 'vitest';
import {
  buildFactualityInstructions,
  buildBrandContext,
  screenGeneratedCopy,
  hasBlockingFindings,
  summarizeFindings,
} from '@/lib/brand/guard';
import { brandBrainSchema, DEFAULT_PROHIBITED_CLAIMS } from '@/lib/brand/schema';

/**
 * The factuality guard.
 *
 * Master command §6 forbids OwBrand from inventing specifications, prices,
 * reviews, certifications, guarantees, medical claims, legal claims,
 * performance claims and testimonials. Before Phase 2 that rule existed only as
 * a sentence inside a prompt string — a request, not a control. These tests
 * cover both halves of the control it became: the instructions compiled into
 * the system prompt, and the screen over the output.
 */

const brain = brandBrainSchema.parse({
  name: 'Noor Skin',
  tagline: 'Skincare that respects your barrier',
  positioning: {
    usp: 'The only barrier-first routine formulated for hard-water cities',
    differentiators: ['Barrier-first', 'Hard-water tested'],
    marketPosition: 'premium accessible',
  },
  audience: {
    summary: 'Women 25-40 in urban hard-water areas',
    painPoints: ['Tightness after washing', 'Products that sting'],
  },
  voice: {
    voice: 'Calm, specific, never hyped',
    tone: ['warm', 'clinical'],
    preferredWords: ['barrier', 'gentle'],
    avoidedWords: ['miracle', 'detox'],
    writingRules: ['Never promise a timeline'],
    exampleCopy: 'Your skin is not broken. It is thirsty.',
  },
  visualIdentity: {
    colors: [{ name: 'Clay', hex: '#C8785A', role: 'primary' }],
    direction: 'Soft daylight, ceramic surfaces',
  },
  guidelines: {
    doRules: ['Lead with the barrier'],
    dontRules: ['Never compare to prescription treatments'],
    approvedClaims: ['Formulated without fragrance'],
    prohibitedClaims: ['Suitable for eczema'],
  },
  contentStrategy: { pillars: [{ name: 'Barrier science', weight: 40 }] },
});

describe('buildFactualityInstructions', () => {
  it('always includes the default prohibitions', () => {
    const instructions = buildFactualityInstructions({ brandBrain: brain });
    for (const claim of DEFAULT_PROHIBITED_CLAIMS) {
      expect(instructions).toContain(claim);
    }
  });

  it('includes the brand’s own prohibited claims', () => {
    expect(buildFactualityInstructions({ brandBrain: brain })).toContain('Suitable for eczema');
  });

  it('lists approved facts when they exist', () => {
    const instructions = buildFactualityInstructions({
      brandBrain: brain,
      approvedFacts: { facts: ['50ml bottle', 'pH 5.5'], numbers: ['50', '5.5'] },
      productName: 'Barrier Cream',
    });

    expect(instructions).toContain('50ml bottle');
    expect(instructions).toContain('pH 5.5');
    expect(instructions).toContain('Barrier Cream');
  });

  it('instructs the model to make NO factual claim when no facts are approved', () => {
    // The dangerous failure mode is a model filling the gap with
    // plausible-sounding detail, so the absence of facts has to be stated as an
    // explicit constraint rather than left implicit.
    const instructions = buildFactualityInstructions({ brandBrain: brain, approvedFacts: { facts: [], numbers: [] } });

    expect(instructions).toContain('none have been recorded');
    // Collapse whitespace: the prompt is hard-wrapped, so the phrase spans a
    // line break in the source.
    const flat = instructions.toLowerCase().replace(/\s+/g, ' ');
    expect(flat).toContain('no factual product assertions at all');
    expect(flat).toContain('do not fill the gap');
  });

  it('works with no Brand Brain at all', () => {
    const instructions = buildFactualityInstructions({ brandBrain: null });
    expect(instructions).toContain('FACTUAL ACCURACY');
    expect(instructions).not.toContain('undefined');
    expect(instructions).not.toContain('null');
  });

  it('forbids the avoided words', () => {
    expect(buildFactualityInstructions({ brandBrain: brain })).toContain('miracle');
  });
});

describe('buildBrandContext', () => {
  const context = buildBrandContext(brain);

  it('includes the strategy that the old route silently dropped', () => {
    // generate-content previously sent only name, description, colours and
    // fonts — so none of the following ever reached the model.
    expect(context).toContain('The only barrier-first routine');
    expect(context).toContain('Calm, specific, never hyped');
    expect(context).toContain('Women 25-40');
    expect(context).toContain('Tightness after washing');
    expect(context).toContain('Barrier science');
    expect(context).toContain('Never promise a timeline');
  });

  it('includes the voice example so tone is demonstrated', () => {
    expect(context).toContain('Your skin is not broken');
  });

  it('includes brand colours with their role', () => {
    expect(context).toContain('#C8785A');
    expect(context).toContain('primary');
  });

  it('never emits undefined or null placeholders', () => {
    const sparse = brandBrainSchema.parse({
      name: 'Bare',
      tagline: 't',
      positioning: { usp: 'u' },
    });
    const output = buildBrandContext(sparse);
    expect(output).not.toContain('undefined');
    expect(output).not.toContain('null');
  });
});

describe('screenGeneratedCopy — blocking categories', () => {
  const cases: Array<[string, string, string]> = [
    ['medical_claim', 'This cream cures eczema in two weeks.', 'cures'],
    ['medical_claim', 'Clinically proven to reduce redness.', 'Clinically proven'],
    ['guarantee', 'Guaranteed results or your money back.', 'Guaranteed results'],
    ['guarantee', '100% effective on every skin type.', '100% effective'],
    ['fabricated_social_proof', 'Loved by 12,000 happy customers.', 'customers'],
    ['fabricated_social_proof', 'Rated 4.9 out of 5 by our community.', 'Rated 4.9'],
    ['invented_certification', 'Certified organic and cruelty-free.', 'Certified organic'],
    ['legal_or_financial_advice', 'Your purchase is tax-deductible.', 'tax-deductible'],
  ];

  for (const [category, copy, excerpt] of cases) {
    it(`flags ${category}: "${excerpt}"`, () => {
      const findings = screenGeneratedCopy(copy);
      const match = findings.find((f) => f.category === category);

      expect(match, `expected a ${category} finding for ${JSON.stringify(copy)}`).toBeDefined();
      expect(match!.severity).toBe('block');
      expect(hasBlockingFindings(findings)).toBe(true);
    });
  }
});

describe('screenGeneratedCopy — review-level findings', () => {
  it('flags unverifiable superlatives for review, not blocking', () => {
    const findings = screenGeneratedCopy("The world's best barrier cream.");
    const match = findings.find((f) => f.category === 'unverifiable_superlative');
    expect(match?.severity).toBe('review');
  });

  it('flags an award claim', () => {
    expect(screenGeneratedCopy('Our award-winning serum.').some((f) => f.category === 'unverifiable_superlative')).toBe(
      true
    );
  });
});

describe('screenGeneratedCopy — unsupported figures', () => {
  it('flags a price that is not in the approved facts', () => {
    const findings = screenGeneratedCopy('Just $49 for a full routine.', {
      approvedFacts: { facts: ['50ml bottle'], numbers: ['50'] },
    });
    expect(findings.some((f) => f.category === 'unsupported_figure' && f.excerpt.includes('49'))).toBe(true);
  });

  it('accepts a figure that IS in the approved facts', () => {
    const findings = screenGeneratedCopy('A generous 50ml bottle.', {
      approvedFacts: { facts: ['50ml bottle'], numbers: ['50'] },
    });
    expect(findings.some((f) => f.category === 'unsupported_figure')).toBe(false);
  });

  it('ignores bare numerals that are not measurements', () => {
    // Flagging every digit would make the guard unusable in practice.
    const findings = screenGeneratedCopy('3 ways to layer your routine.', {
      approvedFacts: { facts: [], numbers: [] },
    });
    expect(findings.some((f) => f.category === 'unsupported_figure')).toBe(false);
  });

  it('flags a percentage', () => {
    const findings = screenGeneratedCopy('Reduces dryness by 87%.', { approvedFacts: { facts: [], numbers: [] } });
    expect(findings.some((f) => f.excerpt.includes('87'))).toBe(true);
  });

  it('explains that nothing can be verified when no facts exist', () => {
    const findings = screenGeneratedCopy('Only $25.', { approvedFacts: { facts: [], numbers: [] } });
    const figure = findings.find((f) => f.category === 'unsupported_figure');
    expect(figure?.explanation).toContain('no approved facts');
  });
});

describe('screenGeneratedCopy — brand-specific prohibitions', () => {
  it('flags a claim the brand explicitly prohibited', () => {
    const findings = screenGeneratedCopy('Gentle enough to be suitable for eczema.', { brandBrain: brain });
    const match = findings.find((f) => f.category === 'brand_prohibited_claim');
    expect(match?.severity).toBe('block');
  });
});

describe('screenGeneratedCopy — clean copy', () => {
  it('passes on-brand copy with no factual assertions', () => {
    const findings = screenGeneratedCopy(
      'Your skin is not broken. It is thirsty. Start with the barrier, and the rest follows.',
      { approvedFacts: { facts: [], numbers: [] }, brandBrain: brain }
    );

    expect(findings).toEqual([]);
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it('returns nothing for empty copy', () => {
    expect(screenGeneratedCopy('')).toEqual([]);
    expect(screenGeneratedCopy('   ')).toEqual([]);
  });
});

describe('regex statefulness', () => {
  it('gives the same answer on repeated calls', () => {
    // The patterns are module-level /g regexes, so a missing lastIndex reset
    // would make every second call miss.
    const copy = 'This cream cures eczema.';
    const first = screenGeneratedCopy(copy);
    const second = screenGeneratedCopy(copy);
    const third = screenGeneratedCopy(copy);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe('summarizeFindings', () => {
  it('reports the clean case', () => {
    expect(summarizeFindings([])).toContain('No factuality issues');
  });

  it('counts blocking and review findings separately', () => {
    const findings = screenGeneratedCopy("This cures eczema and is the world's best.");
    const summary = summarizeFindings(findings);
    expect(summary).toMatch(/blocking/);
    expect(summary).toMatch(/review/);
  });
});
