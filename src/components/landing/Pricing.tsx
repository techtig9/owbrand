'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { PLANS, launchPrice } from '@/lib/plans';

const PLAN_ORDER = ['free', 'starter', 'pro', 'business'] as const;

const HIGHLIGHTS: Record<(typeof PLAN_ORDER)[number], string[]> = {
  free: ['500 credits/mo', 'Static HTML/CSS site', '5 templates & themes', 'Community support'],
  starter: ['10,000 credits/mo', 'Full-stack website', 'AI Content Studio + Scheduler', '1 connected account, 1 domain'],
  pro: ['30,000 credits/mo', 'Priority generation', '3 connected accounts, 5 domains', '100 themes, 300+ templates'],
  business: ['75,000 credits/mo', 'Unlimited accounts & domains', 'All templates & themes', '24/7 priority support'],
};

export function Pricing() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-xl text-center reveal">
          <span className="section-eyebrow mx-auto">Pricing</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Credits that map to real output.</h2>
          <p className="mt-4 text-content-secondary">Every plan&apos;s first month ships with a launch discount, on us.</p>

          <div className="mx-auto mt-8 inline-flex items-center gap-1 rounded-full border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => setYearly(false)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${!yearly ? 'bg-ink text-canvas' : 'text-content-secondary'}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setYearly(true)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${yearly ? 'bg-ink text-canvas' : 'text-content-secondary'}`}
            >
              Yearly
            </button>
          </div>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-4">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const isFree = id === 'free';
            const isPro = id === 'pro';
            const displayPrice = isFree ? 0 : yearly ? Math.round((plan.priceYearly / 12) * 100) / 100 : launchPrice(plan);

            return (
              <div
                key={id}
                className={`reveal flex flex-col rounded-2xl border p-6 ${
                  isPro ? 'border-primary bg-surface shadow-pop' : 'border-line bg-surface shadow-soft'
                }`}
              >
                {isPro && (
                  <span className="mb-3 inline-flex w-fit rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-fg">
                    Most popular
                  </span>
                )}
                <h3 className="font-display text-lg font-semibold text-ink">{plan.label}</h3>

                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold text-ink">${displayPrice}</span>
                  {!isFree && <span className="text-sm text-content-tertiary">/mo</span>}
                </div>
                {!isFree && !yearly && (
                  <p className="mt-1 text-xs text-primary">{plan.launchDiscountPct}% off your first month</p>
                )}
                {!isFree && yearly && <p className="mt-1 text-xs text-content-tertiary">billed ${plan.priceYearly}/yr</p>}

                <ul className="mt-6 flex-1 space-y-3">
                  {HIGHLIGHTS[id].map((line) => (
                    <li key={line} className="flex items-start gap-2 text-sm text-content-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2.5} />
                      {line}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/signup"
                  className={`mt-8 w-full text-center ${isPro ? 'btn-accent' : isFree ? 'btn-ghost' : 'btn-primary'}`}
                >
                  {isFree ? 'Start free' : 'Get started'}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs text-content-tertiary">
          Unused credits expire at renewal. Extra credit top-ups available à la carte.
        </p>
      </div>
    </section>
  );
}
