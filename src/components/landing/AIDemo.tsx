import { isConfigured } from '@/lib/env';
import { isDistributed } from '@/lib/security/rate-limit';
import { DemoForm } from './DemoForm';
import { DemoPreview } from './DemoPreview';

/**
 * "See it work" — and it now actually does, when it can.
 *
 * What this replaced was a static mockup with THREE DEAD CONTROLS: a "Generate"
 * button with no handler, a microphone button with no handler, and three
 * device tabs that switched nothing. All three looked interactive, sat under a
 * heading promising a demonstration, and did nothing at all when clicked. That
 * is the "never ship a button that does nothing" rule broken three times in
 * one component, on the highest-traffic page on the site.
 *
 * Availability is resolved on the server, not guessed in the browser, so the
 * page is never rendered with a control that cannot work:
 *
 *   - AI provider configured AND distributed rate limiting present → a real,
 *     rate-limited, no-signup demo (`DemoForm`).
 *   - Otherwise → a static preview that says plainly it is an example rather
 *     than live output, and carries no interactive controls at all
 *     (`DemoPreview`).
 *
 * The second branch is not a downgrade to hide behind. It is what honesty
 * looks like when the deployment genuinely cannot run the demo: an illustration
 * labelled as an illustration beats a button that lies.
 */
export function AIDemo() {
  const live = isConfigured.ai() && isDistributed();

  return (
    <section id="ai-demo" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="reveal mx-auto max-w-xl text-center">
          <span className="section-eyebrow mx-auto">See it work</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            From a sentence to a brand sketch.
          </h2>
          <p className="mt-4 text-content-secondary">
            {live
              ? 'Describe a business in a line or two. No account, no card — this runs the real generator against a small schema.'
              : 'Describe a business and owbrand sketches the start of its identity. The example below shows the shape of the output.'}
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-2xl">{live ? <DemoForm /> : <DemoPreview />}</div>
      </div>
    </section>
  );
}
