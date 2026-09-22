/**
 * The public changelog.
 *
 * A typed array rather than MDX files, because every entry is two lines and a
 * date — the overhead of a file per release would guarantee the log goes stale.
 *
 * Newest first, and each entry says what CHANGED for a user rather than what
 * was committed. "Refactored the credit ledger" is not a changelog entry; "you
 * are no longer charged for a generation that failed" is.
 *
 * Entries describing work that is not finished belong in ROADMAP.md, not here.
 * A changelog is a record of things that are true now.
 */

export type ChangeKind = 'added' | 'fixed' | 'changed' | 'security';

export interface ChangelogEntry {
  date: string;
  version?: string;
  changes: Array<{ kind: ChangeKind; text: string }>;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-22',
    changes: [
      {
        kind: 'added',
        text: 'A setup checklist on the dashboard, derived from your actual account rather than stored flags — so it stops claiming a step is done when the thing it counted has been deleted.',
      },
      {
        kind: 'added',
        text: 'Credit usage is now metered on the dashboard, with an upgrade offer only when the remaining balance actually warrants one.',
      },
      {
        kind: 'added',
        text: 'A feedback button in the top bar. It sends the page you were on, so you do not have to describe where you were.',
      },
      {
        kind: 'added',
        text: 'A referral code per account. The reward is paid when the account you referred actually reaches a first successful generation, not when it signs up.',
      },
      {
        kind: 'added',
        text: 'A brand sketch you can try on the landing page without an account, where the deployment has an AI provider configured.',
      },
      {
        kind: 'fixed',
        text: 'The FAQ described three features that do not exist — a reel compositing step, a built-in code editor, and one-click deployment. All three are now stated accurately, including what is not built.',
      },
      {
        kind: 'fixed',
        text: '"Skip to main content" did nothing on the landing page and all four sign-in pages, because there was no main landmark to skip to.',
      },
      {
        kind: 'security',
        text: 'The scheduled-job endpoints no longer tell an anonymous caller that they exist, what they do, or which environment variable is missing.',
      },
      {
        kind: 'security',
        text: 'Two unused database tables had row-level security switched off. Both are now locked down.',
      },
      {
        kind: 'security',
        text: 'A missing billing webhook secret is now distinguishable from a forged signature, instead of both reporting "invalid signature".',
      },
    ],
  },
  {
    date: '2026-09-08',
    changes: [
      {
        kind: 'added',
        text: 'A dark theme, designed rather than inverted, with a three-state light/dark/system control that remembers your choice.',
      },
      {
        kind: 'added',
        text: 'Command palette on ⌘K, and a navigation drawer on phones — the app was previously unreachable below tablet width except by typing URLs.',
      },
      {
        kind: 'fixed',
        text: 'The dashboard listed open recommendations from every account, not only your own.',
      },
      {
        kind: 'changed',
        text: 'Analytics now report an unmeasured metric as absent rather than as zero, so a chart no longer draws a confident line through data nobody collected.',
      },
    ],
  },
];
