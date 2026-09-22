'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FAQS } from '@/lib/marketing/faq';

/**
 * The FAQ accordion.
 *
 * Content comes from `lib/marketing/faq.ts`, which the FAQPage structured data
 * also reads — see the note there about three answers that described features
 * the product does not have.
 *
 * The markup is a disclosure pattern rather than the original `<div>` + button:
 * each answer is a region the button controls and labels, so a screen reader
 * announces the relationship instead of a button followed by unattached prose.
 * The answer also stays mounted and is hidden with `hidden`, so in-page find
 * can reach it — collapsed content that is unmounted is invisible to Ctrl-F,
 * which is how most people actually use an FAQ.
 */
export function FAQ() {
  const baseId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="border-t border-[color:var(--color-border)] bg-surface-raised py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="reveal text-center">
          <span className="section-eyebrow mx-auto">FAQ</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Questions, answered.</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-content-secondary">
            Including the parts that are not finished. Every answer here is checkable against the product.
          </p>
        </div>

        <div className="mt-12 space-y-3">
          {FAQS.map((item, index) => {
            const open = openIndex === index;
            const buttonId = `${baseId}-q-${index}`;
            const panelId = `${baseId}-a-${index}`;

            return (
              <div
                key={item.question}
                className="reveal overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-surface"
              >
                <h3>
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(open ? null : index)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-micro hover:bg-surface-raised"
                  >
                    <span className="text-base font-semibold text-content">{item.question}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 text-content-secondary transition-transform duration-standard ${
                        open ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </h3>

                {/* Hidden rather than unmounted: an unmounted answer cannot be
                    found by the browser's own find-in-page. */}
                <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open}>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-content-secondary">{item.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
