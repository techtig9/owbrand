'use client';

import { cn } from './cn';

/**
 * Presentational primitives: Card, Badge, Avatar, Progress, Table, Skeleton,
 * EmptyState.
 *
 * Grouped in one file because each is small and they are almost always
 * imported together; splitting them into seven files would add imports without
 * adding clarity.
 */

/* ------------------------------------------------------------------ Card */

/**
 * `as` exists so a card inside a list can be an `<li>`, and a self-contained
 * piece of content can be an `<article>`. Wrapping list items in divs is the
 * usual shortcut, and it costs the list its item count in a screen reader.
 *
 * Props are typed against `HTMLElement`, not `HTMLDivElement`: the narrower
 * type makes every event handler div-specific, so handing them to an `<li>` is
 * a type error even though the DOM is perfectly happy with it.
 */
export function Card({
  className,
  interactive,
  as: Tag = 'div',
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  interactive?: boolean;
  as?: 'div' | 'article' | 'section' | 'li';
}) {
  return <Tag className={cn(interactive ? 'card-interactive' : 'card', className)} {...rest} />;
}

/* ----------------------------------------------------------------- Badge */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai';

/**
 * `children` is required and typed as ReactNode rather than optional, because
 * a badge with no text is state carried by colour alone — which is invisible
 * to a colour-blind user and to a screen reader both (WCAG 1.4.1).
 */
export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn(`badge-${tone}`, className)}>{children}</span>;
}

/* ---------------------------------------------------------------- Avatar */

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  /** Used for the initial AND the accessible name. Never optional. */
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dimension = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-12 w-12 text-base' }[size];
  const initial = name.trim().slice(0, 1).toUpperCase() || '?';

  if (src) {
    /*
     * Raw <img>, same reasoning as dashboard/products: avatars are remote,
     * already thumbnail-sized, and frequently signed URLs whose signature
     * rotates, which makes every rotation a fresh optimizer cache miss.
     */
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        className={cn('shrink-0 rounded-full object-cover', dimension, className)}
      />
    );
  }

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary-subtle font-bold text-primary-on-subtle',
        dimension,
        className
      )}
    >
      {/* The letter is decorative; the name below is what gets announced. */}
      <span aria-hidden="true">{initial}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

/* -------------------------------------------------------------- Progress */

/**
 * A determinate progress bar.
 *
 * The numeric value is rendered as text next to the bar, not only encoded in
 * its width. A bar alone is unreadable to anyone who cannot see it and
 * imprecise for everyone else.
 */
export function Progress({
  value,
  max = 100,
  label,
  showValue = true,
  tone = 'primary',
  className,
}: {
  value: number;
  max?: number;
  label: string;
  showValue?: boolean;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(value, max));
  const percent = max === 0 ? 0 : (clamped / max) * 100;
  const colour = `var(--color-${tone})`;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-content-secondary">{label}</span>
        {showValue && (
          <span className="tabular-nums text-content-tertiary">
            {clamped.toLocaleString()} / {max.toLocaleString()}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className="h-full rounded-full transition-[width] duration-standard"
          style={{ width: `${percent}%`, backgroundColor: colour }}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Table */

/**
 * A data table with the parts that are easy to leave out: a caption naming it,
 * `scope` on every header so a screen reader can associate cells with columns,
 * and a scroll container that is focusable and labelled — because a div with
 * `overflow-x-auto` cannot be scrolled by keyboard unless it can be focused.
 */
export function Table({
  caption,
  captionVisible = false,
  columns,
  children,
  className,
}: {
  caption: string;
  captionVisible?: boolean;
  columns: Array<{ key: string; label: string; numeric?: boolean; className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`${caption} (scrollable)`}
      className={cn('overflow-x-auto rounded-lg border border-[color:var(--color-border)]', className)}
    >
      <table className="w-full min-w-full border-collapse text-sm">
        <caption
          className={cn(
            'px-4 py-3 text-left text-sm font-semibold text-content',
            !captionVisible && 'sr-only'
          )}
        >
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-[color:var(--color-border)] bg-surface-raised">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-content-secondary',
                  column.numeric ? 'text-right' : 'text-left',
                  column.className
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  numeric,
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cn('px-4 py-3 text-content', numeric && 'text-right tabular-nums', className)} {...rest} />
  );
}

/* -------------------------------------------------------------- Skeleton */

/**
 * Loading skeleton. Consolidates eleven hand-rolled `animate-pulse` divs that
 * each picked a different height — so the layout jumped differently on every
 * page, and none of them told assistive tech that anything was loading.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton', className)} />;
}

export function LoadingPanel({
  rows = 3,
  height = 'h-24',
  label = 'Loading',
}: {
  rows?: number;
  height?: string;
  label?: string;
}) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className={cn('w-full', height)} />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/* ------------------------------------------------------------ EmptyState */

/**
 * An empty state must offer a way out. `action` is required for that reason:
 * "Nothing here yet" with no next step is a dead end, and the growth brief
 * asks for an example plus one clear action.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-[color:var(--color-border)] bg-surface px-6 py-14 text-center',
        className
      )}
    >
      {icon && (
        <span
          className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-surface-raised text-content-tertiary"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <h3 className="text-base font-semibold text-content">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-content-secondary">{body}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}
