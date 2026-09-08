'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PLANS, launchPrice } from '@/lib/plans';
import type { PlanId } from '@/types';

const PAID_PLANS = ['starter', 'pro', 'business'] as const;

export function PlanGrid({ currentPlan }: { currentPlan: PlanId }) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch('/api/billing/manage-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not cancel.');
        return;
      }
      toast.success('Your plan will end at the close of the current billing period.');
    } catch {
      toast.error('Network error — please try again.');
    } finally {
      setCancelling(false);
    }
  }

  async function handleUpgrade(plan: (typeof PAID_PLANS)[number]) {
    setLoadingPlan(plan);
    try {
      const res = await fetch('/api/billing/paddle-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, cadence: 'monthly' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not start checkout.');
        return;
      }

      // Paddle.js overlay — initialized once in the billing layout with
      // NEXT_PUBLIC_PADDLE_CLIENT_TOKEN. See @paddle/paddle-js docs for
      // Paddle.Initialize(...) wiring; this just opens the checkout.
      window.Paddle?.Checkout.open({
        items: [{ priceId: data.priceId, quantity: 1 }],
        customer: data.customer,
        customData: data.customData,
      });
    } catch {
      toast.error('Network error — please try again.');
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        {PAID_PLANS.map((id) => {
          const plan = PLANS[id];
          const isCurrent = currentPlan === id;
          return (
            <div key={id} className="rounded-2xl border border-line bg-surface p-5">
              <h3 className="font-display text-base font-semibold text-ink">{plan.label}</h3>
              <p className="mt-2 font-display text-2xl font-bold text-ink">
                ${launchPrice(plan)}
                <span className="text-xs font-normal text-content-tertiary">/mo first month</span>
              </p>
              <p className="mt-1 text-xs text-content-tertiary">{plan.monthlyCredits.toLocaleString()} credits/mo</p>
              <button
                type="button"
                disabled={isCurrent || loadingPlan === id}
                onClick={() => handleUpgrade(id)}
                className={`mt-4 w-full rounded-full px-4 py-2 text-xs font-semibold ${
                  isCurrent ? 'cursor-default bg-surface-raised text-content-tertiary' : 'btn-accent'
                }`}
              >
                {isCurrent ? 'Current plan' : loadingPlan === id ? 'Loading…' : 'Upgrade'}
              </button>
            </div>
          );
        })}
      </div>

      {currentPlan !== 'free' && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="text-xs font-medium text-content-tertiary underline decoration-dotted hover:text-primary"
        >
          {cancelling ? 'Cancelling…' : 'Cancel my subscription'}
        </button>
      )}
    </div>
  );
}
