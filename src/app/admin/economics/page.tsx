import { AlertTriangle } from 'lucide-react';
import { computeEconomics, freeTierBurn } from '@/lib/economics';
import { budgetStatus } from '@/lib/ai/budget';
import { Badge, Card, Table, Td } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Unit economics.
 *
 * The page that answers whether the business works. Every figure is computed
 * from logged AI spend, and an unmeasurable one renders as "no data" rather
 * than as a zero — a 100% margin on a plan with no users is the number someone
 * would price a launch around, and it would be an artefact of dividing by
 * nothing.
 */
export default async function AdminEconomicsPage() {
  const [report, budget] = await Promise.all([computeEconomics(30), budgetStatus()]);
  const burn = freeTierBurn(report);

  const percent = (value: number | null) =>
    value === null ? null : `${Math.round(value * 1000) / 10}%`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Unit economics</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-content-secondary">
          AI cost per active user against plan price, over the last {report.windowDays} days.{' '}
          {report.caveat}
        </p>
      </div>

      {report.lossMaking.length > 0 && (
        <div role="alert" className="rounded-2xl border border-danger bg-danger-subtle p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-danger">
                {report.lossMaking.length === 1 ? 'A plan is' : 'Plans are'} losing money
              </p>
              <p className="mt-1 text-sm leading-6 text-content-secondary">
                {report.lossMaking.join(', ')} — AI cost per user exceeds the price. Either the
                credit allowance is too generous for the price, or the plan needs to cost more.
              </p>
            </div>
          </div>
        </div>
      )}

      <Card>
        <Table
          caption="AI cost per active user against plan price"
          columns={[
            { key: 'plan', label: 'Plan' },
            { key: 'price', label: 'Price', numeric: true },
            { key: 'users', label: 'Active', numeric: true },
            { key: 'cost', label: 'AI cost / user', numeric: true },
            { key: 'margin', label: 'Margin', numeric: true },
          ]}
        >
          {report.plans.map((plan) => (
            <tr key={plan.plan} className="border-t border-[color:var(--color-border)]">
              <Td>
                <span className="font-medium capitalize">{plan.plan}</span>
              </Td>
              <Td>
                <span className="tabular-nums">
                  {plan.priceUsd === null ? <span className="text-content-tertiary">free</span> : `$${plan.priceUsd}`}
                </span>
              </Td>
              <Td>
                <span className="tabular-nums">{plan.activeUsers}</span>
              </Td>
              <Td>
                <span className="tabular-nums">
                  {plan.costPerUserUsd === null ? (
                    /* Not $0.00. No users is no data, and a zero here reads
                       as "this plan costs nothing to run". */
                    <span className="text-content-tertiary">no data</span>
                  ) : (
                    `$${plan.costPerUserUsd.toFixed(2)}`
                  )}
                </span>
              </Td>
              <Td>
                {plan.margin === null ? (
                  <span className="text-content-tertiary">—</span>
                ) : (
                  <Badge tone={plan.negative ? 'danger' : plan.margin > 0.7 ? 'success' : 'warning'}>
                    {percent(plan.margin)}
                  </Badge>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-content">Free tier</h2>
          {burn.costPerFreeUserUsd === null ? (
            <p className="mt-2 text-sm text-content-tertiary">
              No free users with recorded AI usage in this window.
            </p>
          ) : (
            <>
              <p className="mt-2 text-2xl font-bold tabular-nums text-content">
                ${burn.costPerFreeUserUsd.toFixed(2)}
                <span className="ml-1 text-sm font-normal text-content-tertiary">per user</span>
              </p>
              <p className="mt-1 text-xs leading-5 text-content-secondary">
                ${burn.monthlyBurnUsd.toFixed(2)} total.
                {burn.breakEvenConversionRate !== null && (
                  <>
                    {' '}
                    {percent(burn.breakEvenConversionRate)} of free users must convert to the
                    cheapest paid plan for the free tier to pay for itself.
                  </>
                )}
              </p>
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-content">Spend controls</h2>
          <p className="mt-2 text-sm leading-6 text-content-secondary">
            {budget.killSwitch ? (
              <span className="font-medium text-danger">Kill switch is ON — no generation is running.</span>
            ) : budget.globalCapUsd === 0 ? (
              <span className="text-warning">No global daily cap is set.</span>
            ) : (
              <>
                ${budget.globalSpentUsd.toFixed(2)} spent of ${budget.globalCapUsd} in the last 24
                hours.
              </>
            )}
          </p>
          <p className="mt-2 text-xs leading-5 text-content-tertiary">
            Per-user cap: {budget.userCapUsd === 0 ? 'none' : `$${budget.userCapUsd}/day`}. Set with
            AI_DAILY_BUDGET_USD and AI_USER_DAILY_BUDGET_USD.
          </p>
        </Card>
      </div>

      <p className="text-xs leading-5 text-content-tertiary">
        Total AI spend across all users in the window: ${report.totalCostUsd.toFixed(2)}. Usage from
        deleted accounts is included in this total but attributed to no plan.
      </p>
    </div>
  );
}
