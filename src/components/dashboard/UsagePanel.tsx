import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import { Badge, Button, Card, Progress } from '@/components/ui';
import { PLANS } from '@/lib/plans';
import { usageState } from '@/lib/onboarding/steps';
import type { PlanId } from '@/types';

/**
 * Credit usage, and an upgrade prompt only when one is warranted.
 *
 * Three rules, all of which exist because the obvious implementation of an
 * upgrade prompt is mildly dishonest:
 *
 *  1. **Never prompt an unlimited plan.** A negative remainder is the
 *     unlimited convention here, and pressing an upgrade on someone who cannot
 *     run out reads as dishonest even when it is only careless.
 *  2. **The threshold is a remainder, not a percentage.** 80% used is one
 *     generation left on the free plan and dozens on Business. A percentage
 *     alone nags the wrong people and fails to warn the right ones.
 *  3. **The next plan is named with its real numbers**, taken from
 *     `lib/plans.ts`. "Upgrade for more" with no figure is asking for a
 *     decision while withholding what it depends on.
 */
export function UsagePanel({ plan, creditsRemaining }: { plan: PlanId; creditsRemaining: number }) {
  const definition = PLANS[plan];
  const usage = usageState(creditsRemaining, definition.monthlyCredits);

  const nextPlan = nextPlanUp(plan);

  if (creditsRemaining < 0) {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-content">Credits</h2>
          <Badge tone="success">Unlimited</Badge>
        </div>
        <p className="mt-2 text-sm text-content-secondary">
          This account has no credit ceiling, so there is nothing to meter.
        </p>
      </Card>
    );
  }

  const tone = usage.level === 'exhausted' ? 'danger' : usage.level === 'nearly_out' ? 'warning' : 'primary';

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-content">Credits this period</h2>
        <Badge tone="neutral">{definition.label}</Badge>
      </div>

      <div className="mt-4">
        <Progress label="Credits remaining" value={usage.remaining} max={usage.allowance} tone={tone} />
      </div>

      {/* The state in words, not only in the bar's colour. */}
      <p className="mt-3 text-sm leading-6 text-content-secondary">
        {usage.level === 'exhausted'
          ? 'You have used this period’s credits. Generations are refused until the period resets — nothing is charged and nothing is queued silently.'
          : usage.level === 'nearly_out'
            ? `About ${usage.remaining.toLocaleString()} credits left — roughly a handful of generations.`
            : usage.level === 'approaching'
              ? `You have used ${Math.round(usage.percentUsed)}% of this period’s credits.`
              : `${usage.remaining.toLocaleString()} of ${usage.allowance.toLocaleString()} credits left.`}
      </p>

      {usage.shouldPrompt && nextPlan && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-surface-raised p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-content">
              {PLANS[nextPlan].label} includes {PLANS[nextPlan].monthlyCredits.toLocaleString()} credits a
              month
            </p>
            <p className="mt-0.5 text-xs text-content-secondary">
              ${PLANS[nextPlan].priceMonthly}/month ·{' '}
              {Math.round(PLANS[nextPlan].monthlyCredits / Math.max(definition.monthlyCredits, 1))}× your
              current allowance
            </p>
          </div>
          <Link href="/dashboard/billing">
            <Button size="sm" icon={<TrendingUp className="h-3.5 w-3.5" />}>
              Compare plans
            </Button>
          </Link>
        </div>
      )}

      {usage.shouldPrompt && !nextPlan && (
        // Already on the top plan. Offering an upgrade that does not exist is
        // worse than offering nothing.
        <p className="mt-4 rounded-md bg-surface-raised p-4 text-sm leading-6 text-content-secondary">
          You are on the highest plan. Credits reset at the start of each billing period, and top-ups can be
          bought separately.
        </p>
      )}
    </Card>
  );
}

/**
 * The next plan up by price, derived rather than hard-coded, so adding a tier
 * to `lib/plans.ts` does not leave this component pointing at the wrong one.
 */
function nextPlanUp(current: PlanId): PlanId | null {
  const ordered = Object.values(PLANS)
    .slice()
    .sort((a, b) => a.priceMonthly - b.priceMonthly);

  const index = ordered.findIndex((plan) => plan.id === current);
  const next = index >= 0 ? ordered[index + 1] : undefined;
  return next ? next.id : null;
}
