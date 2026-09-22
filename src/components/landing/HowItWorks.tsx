import { Brain, PackageCheck, Sparkles, Send } from 'lucide-react';

/**
 * How it works — four steps, in the order a real account goes through them.
 *
 * The section exists because the rest of the page describes capabilities
 * without ever saying what a visitor actually does first. The ordered list is
 * an `<ol>` rather than a grid of divs: the sequence is the content, and a
 * screen reader announces "1 of 4" from the markup instead of from a
 * decorative number nobody can read.
 */

const STEPS = [
  {
    icon: Brain,
    title: 'Describe the business once',
    body: 'One paragraph. owbrand turns it into a Brand Brain — audience, voice, positioning, the claims you are allowed to make and the ones you are not.',
    detail: 'Versioned, so you can restore an earlier one rather than regenerating and hoping.',
  },
  {
    icon: PackageCheck,
    title: 'Add the product facts',
    body: 'Ingredients, dimensions, certifications, whatever is true. These become the only claims generation is permitted to assert.',
    detail: 'Copy asserting something no fact supports is blocked for review, not quietly published.',
  },
  {
    icon: Sparkles,
    title: 'Generate from it, not from a prompt',
    body: 'Website copy, posts, captions, creative briefs. Every one reads the same Brand Brain, which is why the tenth post sounds like the first.',
    detail: 'Credits are reserved before the call and refunded if it fails.',
  },
  {
    icon: Send,
    title: 'Schedule, publish, measure',
    body: 'Queue to a connected account and watch what actually happened. Recommendations cite the numbers they rest on.',
    detail: 'An unmeasured metric is reported as absent — never as a zero that looks like a result.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-[color:var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="reveal max-w-2xl">
          <span className="section-eyebrow">How it works</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Four steps, and the third one is where most tools start.
          </h2>
          <p className="mt-5 text-base leading-7 text-content-secondary">
            Everything downstream reads the same stored brand, which is the whole point. A prompt you retype
            each time produces a different brand each time.
          </p>
        </div>

        <ol className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="stagger-item card p-6"
                style={{ ['--stagger-index' as string]: String(index) }}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-md bg-primary-subtle text-primary-on-subtle">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {/* Decorative: the <ol> already conveys position. */}
                  <span aria-hidden="true" className="stat-value text-sm font-semibold text-content-tertiary">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>

                <h3 className="mt-5 text-base font-semibold text-content">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-content-secondary">{step.body}</p>
                <p className="mt-3 border-t border-[color:var(--color-border)] pt-3 text-xs leading-5 text-content-tertiary">
                  {step.detail}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
