import { describe, expect, it } from 'vitest';
import { brandBrainSchema } from '@/lib/brand/schema';
import { checkConsistency, coverage } from '@/lib/brand/consistency';

/**
 * The brand-consistency check.
 *
 * The tests that matter most are the false-positive ones. A checker that
 * flags three things per paragraph gets switched off on day one, and then it
 * protects nothing — so "does not fire on ordinary copy" is a harder and more
 * important property than "fires on a banned word".
 */

const BRAIN = brandBrainSchema.parse({
  name: 'Kiln',
  tagline: 'Hand-thrown tableware',
  positioning: { usp: 'Small-batch ceramics' },
  voice: {
    voice: 'Warm and plain',
    tone: ['warm', 'direct'],
    preferredWords: ['hand-thrown', 'kiln', 'studio'],
    avoidedWords: ['utilise', 'synergy', 'revolutionary'],
    writingRules: ['Keep sentences under 20 words.'],
  },
  guidelines: {
    dontRules: ['Never mention competitors by name.'],
  },
});

describe('avoided words', () => {
  it('flags one as a blocker', () => {
    const result = checkConsistency('We utilise the finest clay available.', BRAIN);
    const finding = result.findings.find((f) => f.category === 'avoided_word');
    expect(finding?.severity).toBe('blocker');
    expect(finding?.message).toContain('utilise');
  });

  it('quotes surrounding context, not the bare word', () => {
    // "utilise" on its own tells a writer nothing about where to look in a
    // 300-word caption.
    const result = checkConsistency('Our studio in Lisbon will utilise local clay from now on.', BRAIN);
    const finding = result.findings.find((f) => f.category === 'avoided_word');
    expect(finding?.excerpt).toContain('utilise');
    expect(finding!.excerpt.length).toBeGreaterThan('utilise'.length);
  });

  it('matches whole words only', () => {
    // An avoid list with a short term must not fire on substrings, or the
    // checker produces constant false positives and gets ignored.
    const brain = brandBrainSchema.parse({
      name: 'X',
      tagline: 't',
      positioning: { usp: 'u' },
      voice: { avoidedWords: ['AI', 'ad'] },
    });
    const result = checkConsistency('We maintain a chair in the said studio and add glaze.', brain);
    expect(result.findings.filter((f) => f.category === 'avoided_word')).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const result = checkConsistency('A REVOLUTIONARY approach.', BRAIN);
    expect(result.findings.some((f) => f.category === 'avoided_word')).toBe(true);
  });
});

describe('sentence length', () => {
  it('flags a sentence over the limit the brand set', () => {
    const long = `We ${'really '.repeat(25)}care.`;
    const result = checkConsistency(long, BRAIN);
    expect(result.findings.some((f) => f.category === 'sentence_length')).toBe(true);
  });

  it('applies NO limit when the brand has not set one', () => {
    // Imposing a default would be this product inventing a style opinion and
    // attributing it to the customer's brand.
    const brain = brandBrainSchema.parse({ name: 'X', tagline: 't', positioning: { usp: 'u' } });
    const long = `We ${'really '.repeat(40)}care.`;
    const result = checkConsistency(long, brain);
    expect(result.findings.some((f) => f.category === 'sentence_length')).toBe(false);
    expect(result.checked.maxSentenceWords).toBeNull();
  });
});

describe('false positives', () => {
  it('does not flag ordinary on-brand copy', () => {
    const copy =
      'Every piece is hand-thrown in our Lisbon studio. The kiln runs twice a week. We make tableware for restaurants that care how a plate feels.';
    const result = checkConsistency(copy, BRAIN);
    expect(result.findings).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it('does not demand preferred words in a short line', () => {
    // A three-word headline cannot reasonably be asked to include vocabulary.
    const result = checkConsistency('Made by hand.', BRAIN);
    expect(result.findings.some((f) => f.category === 'missing_preferred')).toBe(false);
  });

  it('does ask for them in a long passage that uses none', () => {
    const copy = `We make things. ${'They are good and people like them a lot. '.repeat(3)}`;
    const result = checkConsistency(copy, BRAIN);
    expect(result.findings.some((f) => f.category === 'missing_preferred')).toBe(true);
  });
});

describe('forbidden claims', () => {
  it('reuses the factuality guard rather than restating its patterns', () => {
    const result = checkConsistency('Clinically proven to cure eczema.', BRAIN);
    const finding = result.findings.find((f) => f.category === 'forbidden_claim');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('blocker');
  });
});

describe('the "dont" rules', () => {
  it('raises a SUGGESTION, never a blocker', () => {
    // The match is a keyword heuristic on a prose rule. Blocking on a
    // heuristic reading of a sentence is how a tool loses trust.
    const result = checkConsistency('Unlike our competitors, we fire slowly.', BRAIN);
    const finding = result.findings.find((f) => f.category === 'dont_rule');
    expect(finding?.severity).toBe('suggestion');
    expect(finding?.suggestion).toMatch(/keyword match/i);
  });
});

describe('the score', () => {
  it('is 100 only when nothing checkable is wrong', () => {
    expect(checkConsistency('Hand-thrown in the studio.', BRAIN).score).toBe(100);
  });

  it('falls furthest for blockers', () => {
    const blocker = checkConsistency('We utilise clay.', BRAIN).score;
    const suggestion = checkConsistency('Wow! Amazing! Great!', BRAIN).score;
    expect(blocker).toBeLessThan(suggestion);
  });

  it('never goes below zero', () => {
    const awful = 'Utilise synergy! Revolutionary! Clinically proven to cure everything! Guaranteed!';
    expect(checkConsistency(awful, BRAIN).score).toBeGreaterThanOrEqual(0);
  });

  it('carries a caveat that 100 is not a verdict', () => {
    // A green tick people read as approval is worse than no score at all, so
    // the caveat travels with the result and cannot be dropped by a caller.
    const result = checkConsistency('Hand-thrown.', BRAIN);
    expect(result.caveat).toMatch(/not that the copy is on brand/i);
  });
});

describe('what was checked', () => {
  it('reports an undefined rule as null, not as zero', () => {
    const brain = brandBrainSchema.parse({ name: 'X', tagline: 't', positioning: { usp: 'u' } });
    const result = checkConsistency('Anything at all.', brain);
    // Zero would read as "checked, nothing banned". Null is the truth:
    // there was nothing to check against.
    expect(result.checked.avoidedWords).toBeNull();
    expect(result.checked.dontRules).toBeNull();
  });

  it('counts the rules that do exist', () => {
    const result = checkConsistency('Anything.', BRAIN);
    expect(result.checked.avoidedWords).toBe(3);
    expect(result.checked.maxSentenceWords).toBe(20);
  });
});

describe('coverage', () => {
  it('reports a thin brain as thin', () => {
    const brain = brandBrainSchema.parse({ name: 'X', tagline: 't', positioning: { usp: 'u' } });
    expect(coverage(brain)).toEqual({ defined: 0, total: 5 });
  });

  it('reports a well-defined brain', () => {
    // So a 100 next to "1 of 5 defined" cannot be mistaken for verification.
    // All five signals are set on this fixture: avoided, preferred, rules,
    // dont-rules and tone.
    expect(coverage(BRAIN).defined).toBe(5);
  });
});
