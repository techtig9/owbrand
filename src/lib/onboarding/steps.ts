/**
 * The activation checklist.
 *
 * Every step is DERIVED by counting real rows. Nothing here reads a stored
 * "completed" flag, and that is the whole design:
 *
 *   A flag is a claim about the past. A count is a statement about the present.
 *
 * With flags, a user who deletes their only brand keeps a ticked "create a
 * brand" forever, and the checklist starts describing an account that no longer
 * exists. Worse, it tells them nothing is left to do while the product is
 * unusable. Counting is a few more queries and cannot go stale.
 *
 * The only stored state is in `onboarding_state`, and it holds just the two
 * things that genuinely cannot be derived: whether the checklist was dismissed,
 * and when the account first reached a successful generation — the activation
 * moment, which is unrecoverable once generation rows age out.
 */

export type StepId = 'brand' | 'facts' | 'generate' | 'connect' | 'schedule';

export interface StepCounts {
  brandBrainVersions: number;
  products: number;
  productFacts: number;
  completedGenerations: number;
  connectedAccounts: number;
  scheduledOrPublishedPosts: number;
}

export interface ChecklistStep {
  id: StepId;
  title: string;
  /** What this step buys the user. Not a restatement of the title. */
  body: string;
  href: string;
  cta: string;
  done: boolean;
  /**
   * True when every earlier step is done and this one is not — the single step
   * the UI should emphasise. Exactly one step is ever `next`.
   */
  next: boolean;
}

export interface Checklist {
  steps: ChecklistStep[];
  completed: number;
  total: number;
  /** All steps done. The checklist should stop being shown. */
  finished: boolean;
  /**
   * The activation threshold: a brand, a fact, and one successful generation.
   * Reaching this is the point at which the product has demonstrably worked,
   * and it is deliberately NOT "all five steps" — connecting a social account
   * depends on Meta App Review, which no user can hurry.
   */
  activated: boolean;
}

/**
 * Order matters: it is the order a real account goes through, and `next` is
 * computed from it. Publishing is last because it is the only step gated on
 * something outside the product (a connected account, which needs Meta review).
 */
export function buildChecklist(counts: StepCounts): Checklist {
  const raw: Array<Omit<ChecklistStep, 'next'>> = [
    {
      id: 'brand',
      title: 'Build your Brand Brain',
      body: 'One paragraph about the business becomes the voice, audience and positioning that every later generation reads.',
      href: '/dashboard/ai-generator',
      cta: 'Describe the business',
      done: counts.brandBrainVersions > 0,
    },
    {
      id: 'facts',
      title: 'Add a product and its facts',
      body: 'Approved facts are the only claims generation is allowed to assert. Without them everything is blocked for review.',
      href: '/dashboard/products',
      cta: 'Add a product',
      done: counts.products > 0 && counts.productFacts > 0,
    },
    {
      id: 'generate',
      title: 'Generate something',
      body: 'A post, a caption, website copy. This is the moment the Brand Brain earns its keep.',
      href: '/dashboard/content-studio',
      cta: 'Open the studio',
      done: counts.completedGenerations > 0,
    },
    {
      id: 'connect',
      title: 'Connect an account',
      body: 'Facebook Pages and Instagram business accounts. Publishing permissions need Meta App Review, so start it early.',
      href: '/dashboard/connections',
      cta: 'Connect',
      done: counts.connectedAccounts > 0,
    },
    {
      id: 'schedule',
      title: 'Schedule a post',
      body: 'Queue it and the worker sends it. Nothing is published twice, even with several workers running.',
      href: '/dashboard/scheduler',
      cta: 'Schedule',
      done: counts.scheduledOrPublishedPosts > 0,
    },
  ];

  // `next` is the first incomplete step, so exactly one is ever highlighted.
  // Highlighting all of them is the same as highlighting none.
  const firstIncomplete = raw.findIndex((step) => !step.done);
  const steps: ChecklistStep[] = raw.map((step, index) => ({
    ...step,
    next: index === firstIncomplete,
  }));

  const completed = steps.filter((step) => step.done).length;

  return {
    steps,
    completed,
    total: steps.length,
    finished: completed === steps.length,
    activated:
      counts.brandBrainVersions > 0 && counts.productFacts > 0 && counts.completedGenerations > 0,
  };
}

/* ------------------------------------------------------------------ *
 * Usage and upgrade pressure
 * ------------------------------------------------------------------ */

export type UsageLevel = 'comfortable' | 'approaching' | 'nearly_out' | 'exhausted';

export interface UsageState {
  level: UsageLevel;
  used: number;
  remaining: number;
  allowance: number;
  percentUsed: number;
  /** True when the UI should offer an upgrade. Never true on an unlimited plan. */
  shouldPrompt: boolean;
}

/**
 * Where the account stands against its allowance.
 *
 * Thresholds are on REMAINING work, not on a percentage alone, and the reason
 * is that a percentage lies at both ends of the scale. 80% used means very
 * different things on 500 credits and on 75,000: the first user has one
 * generation left, the second has dozens. `approaching` therefore needs both a
 * high percentage and a genuinely small remainder.
 *
 * A negative `remaining` is the unlimited convention used elsewhere in the
 * codebase (admin and Business tier), and it must never produce a prompt —
 * pressuring someone who cannot run out is the kind of thing that reads as
 * dishonest even when it is only careless.
 */
export function usageState(remaining: number, allowance: number): UsageState {
  if (remaining < 0) {
    return {
      level: 'comfortable',
      used: 0,
      remaining,
      allowance,
      percentUsed: 0,
      shouldPrompt: false,
    };
  }

  const safeAllowance = Math.max(allowance, 1);
  const used = Math.max(0, safeAllowance - remaining);
  const percentUsed = Math.min(100, (used / safeAllowance) * 100);

  let level: UsageLevel;
  if (remaining <= 0) level = 'exhausted';
  else if (percentUsed >= 95 || remaining <= 50) level = 'nearly_out';
  else if (percentUsed >= 80 && remaining <= 2000) level = 'approaching';
  else level = 'comfortable';

  return {
    level,
    used,
    remaining,
    allowance,
    percentUsed,
    shouldPrompt: level !== 'comfortable',
  };
}
