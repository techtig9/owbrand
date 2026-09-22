import { Check, Minus } from 'lucide-react';

/**
 * "How we differ" — and, deliberately, where we do not.
 *
 * The brief asks for an honest differentiation section and forbids comparisons
 * that are not factual and checkable. Two consequences for how this is built:
 *
 *  1. **No competitor is named.** A named comparison makes a factual claim
 *     about somebody else's product that goes stale the moment they ship, and
 *     nobody here is monitoring their release notes. Each row describes the
 *     common approach instead, which is checkable by anyone who has used one.
 *  2. **The second list is real.** "Where owbrand is the wrong choice" names
 *     cases where a visitor should not sign up. A differentiation section with
 *     no such list is a feature list wearing a comparison's clothes — and a
 *     visitor who discovers the limitation after paying is a refund and a
 *     complaint, not a customer.
 *
 * Every claim in the first list is verifiable in this repository, so each row
 * names where.
 */

const DIFFERENCES = [
  {
    common: 'Generates from whatever you type into the box that session',
    ours: 'Generates from a stored, versioned Brand Brain',
    why: 'The tenth post sounds like the first, because both read the same source rather than two different prompts.',
    where: 'lib/brand/store.ts',
  },
  {
    common: 'Will confidently invent a certification, a statistic or a guarantee',
    ours: 'Blocks copy asserting anything your approved facts do not support',
    why: 'A factuality guard flags the claim with the exact excerpt, and approving a blocked item takes a deliberate acknowledgement.',
    where: 'lib/product/factuality.ts',
  },
  {
    common: 'Shows 0% when a platform reported nothing',
    ours: 'Reports an unmeasured metric as absent',
    why: 'A rate with a zero denominator returns null, and per-metric coverage is recorded. A zero that means "no data" is a decision made on a number nobody measured.',
    where: 'lib/analytics/metrics.ts',
  },
  {
    common: 'Recommends things in a confident voice with nothing behind them',
    ours: 'A recommendation cannot be stored without its evidence',
    why: 'The database raises an exception on an empty evidence set, so the constraint is not a convention somebody can forget.',
    where: 'migration 20260908000013',
  },
  {
    common: 'Double-charges or double-posts under concurrency',
    ours: 'Credits and publish jobs are both claimed atomically',
    why: 'Credit deduction is a single database operation, and the publishing worker claims with `for update skip locked` — so two workers cannot send the same post.',
    where: 'lib/publishing/worker.ts',
  },
];

const NOT_FOR = [
  'You need finished video. Reel scripting works; rendering is not built, so there is no file at the end.',
  'You need to publish to TikTok, YouTube, LinkedIn, Pinterest or X. None are supported, and each refuses explicitly rather than accepting a post it cannot send.',
  'You want to publish to Instagram this week. Meta App Review for the publishing permissions takes two to six weeks and nothing here can shorten it.',
  'You want a visual drag-and-drop site builder. Site content is generated and editable as content, not on a canvas.',
];

export function Differentiation() {
  return (
    <section
      id="how-we-differ"
      className="border-t border-[color:var(--color-border)] bg-surface-raised py-24"
    >
      <div className="mx-auto max-w-5xl px-6">
        <div className="reveal max-w-2xl">
          <span className="section-eyebrow">How we differ</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Four guarantees, enforced in the database.
          </h2>
          <p className="mt-5 text-base leading-7 text-content-secondary">
            No competitor is named here — a named comparison makes a factual claim about someone else&apos;s
            product that goes stale the moment they ship. These describe the common approach, and each row
            says where in the codebase ours is enforced.
          </p>
        </div>

        <ul className="mt-14 space-y-4">
          {DIFFERENCES.map((row, index) => (
            <li
              key={row.ours}
              className="stagger-item card p-6"
              style={{ ['--stagger-index' as string]: String(index) }}
            >
              <div className="grid gap-5 md:grid-cols-[1fr_1.15fr]">
                <div>
                  <p className="flex items-start gap-2 text-sm leading-6 text-content-tertiary">
                    <Minus className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="sr-only">The common approach: </span>
                      {row.common}
                    </span>
                  </p>
                  <p className="mt-3 flex items-start gap-2 text-sm font-semibold leading-6 text-content">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    <span>
                      <span className="sr-only">owbrand: </span>
                      {row.ours}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-sm leading-6 text-content-secondary">{row.why}</p>
                  <p className="mt-2 font-mono text-xs text-content-tertiary">{row.where}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="reveal mt-10 rounded-lg border border-[color:var(--color-border-strong)] bg-surface p-6">
          <h3 className="text-base font-semibold text-content">When owbrand is the wrong choice</h3>
          <p className="mt-2 text-sm leading-6 text-content-secondary">
            Worth knowing before you sign up rather than after.
          </p>
          <ul className="mt-4 space-y-2.5">
            {NOT_FOR.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-content-secondary">
                <Minus className="mt-1.5 h-3.5 w-3.5 shrink-0 text-content-tertiary" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
