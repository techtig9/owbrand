/**
 * Dashboard-specific compositions.
 *
 * Skeleton, LoadingPanel and EmptyState used to be defined here AND again as
 * inline divs across eleven screens. They now live in `@/components/ui` and are
 * re-exported from this path so the existing imports keep working — one
 * definition, two import paths, rather than two definitions.
 *
 * What stays here is what is genuinely dashboard-shaped rather than generic.
 */

import { Card } from '@/components/ui';

export { Skeleton, LoadingPanel, EmptyState } from '@/components/ui';

/**
 * A single headline figure.
 *
 * Deliberately NOT in `ui/`: it hard-codes a dashboard's type scale and
 * spacing, and a primitive that assumes its context is a primitive that gets
 * fought with. `ui/Card` is the generic piece underneath.
 */
export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium text-content-tertiary">{label}</p>
      {/* Proportional figures: at this size tabular-nums makes a value like
          121 look loose, because every digit takes a zero's width. */}
      <p className="stat-value mt-1.5 text-2xl font-semibold text-content">{value}</p>
      {hint && <p className="mt-1 text-xs text-content-secondary">{hint}</p>}
    </Card>
  );
}

/**
 * A page heading block.
 *
 * Every screen wrote its own eyebrow/title/description stack with slightly
 * different spacing and type sizes. One component means the shell reads as one
 * product rather than twenty screens.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-content">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-content-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
