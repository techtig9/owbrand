/**
 * Shared primitives, migrated to the semantic tokens.
 *
 * `bg-surface` was the specific problem: a literal white background survives a
 * theme change, so every card built on this component would have stayed white
 * on a deep-indigo dark surface. `bg-surface` resolves through the token and
 * follows the theme.
 */

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium text-content-tertiary">{label}</p>
      {/* Proportional figures: at this size tabular-nums makes a value like
          121 look loose, because every digit takes a zero's width. */}
      <p className="stat-value mt-1.5 text-2xl font-semibold text-content">{value}</p>
      {hint && <p className="mt-1 text-xs text-content-secondary">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[color:var(--color-border)] bg-surface px-6 py-16 text-center">
      <h3 className="text-base font-semibold text-content">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-content-secondary">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/**
 * Loading skeleton.
 *
 * Exists so screens stop hand-rolling `animate-pulse bg-surface-raised` divs,
 * which is what several of them did — each with a different height, so the
 * layout jumped differently on every page.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function LoadingPanel({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-24 w-full" />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/**
 * A page heading block.
 *
 * Every screen was writing its own eyebrow/title/description stack with
 * slightly different spacing and type sizes. One component means the shell
 * reads as one product rather than twenty screens.
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
        {description && <p className="mt-1 max-w-2xl text-sm leading-6 text-content-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
