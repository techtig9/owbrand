import React from 'react';
import Link from 'next/link';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-aurora-soft px-6 py-16">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex justify-center font-display text-2xl font-bold text-ink">
          owbrand
        </Link>

        <div className="glass-panel p-8">
          <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>

          <div className="mt-7">{children}</div>
        </div>

        <p className="mt-6 text-center text-sm text-ink-soft">{footer}</p>
      </div>
    </div>
  );
}

export function FormField({
  label,
  hint,
  error,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  // Stable ids so the label, hint and error are programmatically associated
  // with the input — required for screen readers (WCAG 2.2 AA, 3.3.2 / 4.1.2).
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="block">
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-ink-soft">
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none ${
          error ? 'border-red-400 focus:border-red-500' : 'border-line focus:border-coral-400'
        }`}
      />
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Form-level error banner. `role="alert"` makes assistive technology announce
 * it the moment it appears, which a toast alone does not reliably do.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
    >
      {message}
    </div>
  );
}

/** Success banner with the same announcement guarantees. */
export function FormSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="rounded-xl border border-mint-300 bg-mint-50 px-4 py-3 text-sm font-medium text-mint-600"
    >
      {message}
    </div>
  );
}
