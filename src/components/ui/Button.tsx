'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

/**
 * The one button.
 *
 * Before this existed, screens composed `btn-primary !px-4 !py-2 text-xs` by
 * hand — the `!` overrides are the tell: the shared class was almost right and
 * every caller fought it. Sizes are a prop now, so there is nothing to override.
 *
 * `loading` is the part worth having as a component rather than a class. It
 * disables the control, swaps in a spinner, sets `aria-busy`, and — the piece
 * hand-rolled versions kept forgetting — keeps the label rendered. A button
 * whose text is replaced by a spinner loses its accessible name mid-action, so
 * a screen reader announces nothing at the moment the user most needs feedback.
 */

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Shown before the label. Hidden from assistive tech automatically. */
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  // Quiet action: no border, no fill until hover.
  subtle: 'btn bg-transparent text-content-secondary hover:bg-surface-raised hover:text-content',
};

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: '', // the .btn default
  lg: 'px-5 py-3 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    fullWidth,
    className,
    children,
    disabled,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      // A loading button must not be activatable again, but it is still the
      // same control — not a different, disabled one.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(VARIANT[variant], SIZE[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        icon && (
          <span className="shrink-0" aria-hidden="true">
            {icon}
          </span>
        )
      )}
      {children}
    </button>
  );
});
