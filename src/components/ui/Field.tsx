'use client';

import { forwardRef, useId } from 'react';
import { cn } from './cn';

/**
 * Text input, textarea and select — sharing one label/hint/error contract.
 *
 * The wiring is the reason these are components. Every screen that hand-rolled
 * a labelled input got the visual part right and the association wrong: a
 * `<label>` with no `htmlFor`, a hint paragraph no `aria-describedby` pointed
 * at, an error rendered in red text only. A screen-reader user then hears
 * "edit text" with no name, no hint and no idea why the form was rejected.
 *
 * Here the id is generated, `htmlFor` always matches, hint and error are both
 * in `aria-describedby`, and an error sets `aria-invalid` — so the failure is
 * announced, not merely coloured (WCAG 1.4.1).
 */

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Hides the label visually but keeps it for assistive tech. */
  labelHidden?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
}

function FieldShell({ label, hint, error, required, labelHidden, className, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('block', className)}>
      <label htmlFor={id} className={cn('field-label', labelHidden && 'sr-only')}>
        {label}
        {required && (
          <>
            {' '}
            <span className="text-danger" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-content-tertiary">
          {hint}
        </p>
      )}
      {error && (
        // role="alert" so a validation failure is announced when it appears,
        // not only when the field is next focused.
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string | null;
  labelHidden?: boolean;
  wrapperClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, labelHidden, wrapperClassName, className, required, ...rest },
  ref
) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      labelHidden={labelHidden}
      className={wrapperClassName}
    >
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn('input', invalid && 'border-danger', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string | null;
  labelHidden?: boolean;
  wrapperClassName?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, labelHidden, wrapperClassName, className, required, ...rest },
  ref
) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      labelHidden={labelHidden}
      className={wrapperClassName}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn('input min-h-24 resize-y', invalid && 'border-danger', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string | null;
  labelHidden?: boolean;
  wrapperClassName?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, labelHidden, wrapperClassName, className, required, children, ...rest },
  ref
) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      labelHidden={labelHidden}
      className={wrapperClassName}
    >
      {({ id, describedBy, invalid }) => (
        <select
          ref={ref}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn('input pr-8', invalid && 'border-danger', className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
});
