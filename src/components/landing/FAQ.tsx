'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FAQS = [
  {
    q: 'What AI does owbrand use?',
    a: 'Google Gemini powers everything AI-related — voice transcription, the follow-up question flow, and all Content Studio generation (photos, posts, logos, copy, and reel scripting). Nothing else in owbrand calls an external AI service.',
  },
  {
    q: 'Are reels real AI-generated video?',
    a: 'No — Gemini writes the script, picks pacing, and orders your existing photos/graphics. A lightweight compositing layer then assembles the transitions and animations into a short vertical clip, which keeps reels fast and inexpensive to produce.',
  },
  {
    q: 'What happens if a generation fails?',
    a: "You're not charged. If a Gemini call errors, times out, or fails validation, the credit deduction is rolled back automatically.",
  },
  {
    q: 'Can I keep the code?',
    a: 'Yes — every site you generate can be edited in the built-in code editor and exported as a ZIP, React project, or Next.js project, or deployed straight to Vercel or Netlify.',
  },
  {
    q: 'Do unused credits roll over?',
    a: 'No, monthly credits expire at the end of each billing cycle. You can also purchase extra credit top-ups separately at any time.',
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="border-t border-line bg-surface-raised py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center reveal">
          <span className="section-eyebrow mx-auto">FAQ</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Questions, answered.</h2>
        </div>

        <div className="mt-12 space-y-3">
          {FAQS.map((item, i) => {
            const open = openIndex === i;
            return (
              <div key={item.q} className="reveal overflow-hidden rounded-2xl border border-line bg-surface">
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={open}
                >
                  <span className="font-display text-base font-semibold text-ink">{item.q}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-content-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && <p className="px-5 pb-5 text-sm leading-relaxed text-content-secondary">{item.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
