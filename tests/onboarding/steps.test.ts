import { describe, expect, it } from 'vitest';
import { buildChecklist, usageState, type StepCounts } from '@/lib/onboarding/steps';

const EMPTY: StepCounts = {
  brandBrainVersions: 0,
  products: 0,
  productFacts: 0,
  completedGenerations: 0,
  connectedAccounts: 0,
  scheduledOrPublishedPosts: 0,
};

describe('buildChecklist', () => {
  it('marks nothing done for a brand-new account', () => {
    const checklist = buildChecklist(EMPTY);

    expect(checklist.completed).toBe(0);
    expect(checklist.finished).toBe(false);
    expect(checklist.activated).toBe(false);
  });

  it('highlights exactly one next step', () => {
    for (const counts of [
      EMPTY,
      { ...EMPTY, brandBrainVersions: 1 },
      { ...EMPTY, brandBrainVersions: 1, products: 1, productFacts: 3 },
      { ...EMPTY, brandBrainVersions: 1, products: 1, productFacts: 3, completedGenerations: 2 },
    ]) {
      // Highlighting every incomplete step is the same as highlighting none.
      expect(buildChecklist(counts).steps.filter((s) => s.next)).toHaveLength(1);
    }
  });

  it('highlights no next step once everything is done', () => {
    const checklist = buildChecklist({
      brandBrainVersions: 1,
      products: 1,
      productFacts: 4,
      completedGenerations: 3,
      connectedAccounts: 1,
      scheduledOrPublishedPosts: 1,
    });

    expect(checklist.finished).toBe(true);
    expect(checklist.steps.filter((s) => s.next)).toHaveLength(0);
  });

  /*
   * The property that motivated deriving steps from counts instead of storing
   * flags: state must go BACKWARDS when the underlying rows go away. With
   * flags, a user who deletes their only brand keeps a ticked "create a brand"
   * forever and is told there is nothing left to do while the product is
   * unusable.
   */
  it('un-completes a step when its rows are gone', () => {
    const withBrand = buildChecklist({ ...EMPTY, brandBrainVersions: 1 });
    expect(withBrand.steps[0].done).toBe(true);

    const deleted = buildChecklist({ ...EMPTY, brandBrainVersions: 0 });
    expect(deleted.steps[0].done).toBe(false);
    expect(deleted.completed).toBe(0);
  });

  it('needs a product AND a fact, not just a product', () => {
    // A product with no approved facts blocks every generation, so treating
    // the step as done would send the user on to a dead end.
    const productOnly = buildChecklist({ ...EMPTY, brandBrainVersions: 1, products: 1 });
    expect(productOnly.steps[1].done).toBe(false);

    const withFacts = buildChecklist({ ...EMPTY, brandBrainVersions: 1, products: 1, productFacts: 1 });
    expect(withFacts.steps[1].done).toBe(true);
  });

  /*
   * Activation deliberately excludes connecting an account. That step waits on
   * Meta App Review, which takes weeks and which no user can hurry — so making
   * it part of activation would measure Meta's queue rather than the product.
   */
  it('treats activation as brand + facts + one generation', () => {
    const activated = buildChecklist({
      ...EMPTY,
      brandBrainVersions: 1,
      products: 1,
      productFacts: 2,
      completedGenerations: 1,
    });

    expect(activated.activated).toBe(true);
    expect(activated.finished).toBe(false);
  });
});

describe('usageState', () => {
  it('is comfortable early in the period', () => {
    const state = usageState(9000, 10000);

    expect(state.level).toBe('comfortable');
    expect(state.shouldPrompt).toBe(false);
    expect(state.used).toBe(1000);
  });

  it('never prompts an unlimited plan', () => {
    // A negative remainder is the unlimited convention. Pressing an upgrade on
    // someone who cannot run out reads as dishonest even when it is careless.
    const state = usageState(-1, 10000);

    expect(state.level).toBe('comfortable');
    expect(state.shouldPrompt).toBe(false);
    expect(state.percentUsed).toBe(0);
  });

  it('warns when nearly out', () => {
    expect(usageState(30, 10000).level).toBe('nearly_out');
  });

  it('reports exhaustion distinctly from nearly out', () => {
    // These need different copy: one is a warning, the other is a wall.
    expect(usageState(0, 10000).level).toBe('exhausted');
  });

  /*
   * A percentage alone lies at both ends of the scale. 80% used is one
   * generation left on a 500-credit plan and dozens on a 75,000-credit one, so
   * `approaching` requires a high percentage AND a small remainder.
   */
  it('does not nag a large plan at 80% when thousands remain', () => {
    const large = usageState(15_000, 75_000); // 80% used, 15k left
    expect(large.level).toBe('comfortable');
    expect(large.shouldPrompt).toBe(false);
  });

  it('does warn a small plan at the same percentage', () => {
    const small = usageState(100, 500); // 80% used, 100 left
    expect(small.shouldPrompt).toBe(true);
  });

  it('survives a zero allowance without dividing by zero', () => {
    const state = usageState(0, 0);
    expect(Number.isFinite(state.percentUsed)).toBe(true);
  });

  it('clamps a remainder larger than the allowance', () => {
    // Can happen after a top-up purchase: remaining exceeds the plan's monthly
    // allowance, and `used` must not go negative.
    const state = usageState(12_000, 10_000);
    expect(state.used).toBe(0);
    expect(state.percentUsed).toBe(0);
  });
});
