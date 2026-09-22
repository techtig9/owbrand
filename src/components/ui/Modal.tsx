'use client';

import { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

/**
 * Modal dialog and side drawer, sharing one implementation.
 *
 * Four things a `fixed inset-0` div with a close button does not do, all of
 * which are implemented here:
 *
 *  1. Trap focus. Otherwise Tab walks out of the dialog into the page behind
 *     it, where a screen reader reads content the user cannot see.
 *  2. Restore focus on close, to the element that opened it. Without this,
 *     focus falls back to <body> and a keyboard user restarts from the top of
 *     the page every time they dismiss something.
 *  3. Lock background scroll — while preserving the scrollbar's width, because
 *     simply setting `overflow: hidden` collapses it and the whole page jumps
 *     sideways as the dialog opens.
 *  4. Close on Escape, and on a backdrop click but NOT on a drag that started
 *     inside the panel and ended on the backdrop. Closing on that loses work.
 */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'dialog',
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: 'dialog' | 'drawer';
  size?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pointerDownInsideRef = useRef(false);

  const focusables = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return [] as HTMLElement[];
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement as HTMLElement | null;

    // Focus the panel itself rather than its first control: announcing the
    // dialog's name before its first field is the point of the label wiring.
    panelRef.current?.focus();

    // Preserve the scrollbar's width so the page does not shift as it hides.
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) {
        // Nothing focusable inside: keep focus on the panel rather than
        // letting Tab escape into the page behind.
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap in BOTH directions. Forward-only traps are the common bug:
      // Shift+Tab from the first control still escapes.
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      openerRef.current?.focus?.();
    };
  }, [open, onClose, focusables]);

  if (!open) return null;

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        variant === 'drawer' ? 'justify-end' : 'items-center justify-center p-4'
      )}
    >
      <div
        aria-hidden="true"
        onPointerDown={() => {
          pointerDownInsideRef.current = false;
        }}
        onClick={() => {
          // Only a click that also STARTED on the backdrop closes it. A text
          // selection dragged out of the panel must not discard the dialog.
          if (!pointerDownInsideRef.current) onClose();
        }}
        className="absolute inset-0 bg-[color:var(--color-scrim)] animate-fade-in"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? 'modal-description' : undefined}
        tabIndex={-1}
        onPointerDown={() => {
          pointerDownInsideRef.current = true;
        }}
        className={cn(
          'glass-floating relative z-10 flex w-full flex-col outline-none',
          variant === 'drawer'
            ? 'h-full max-w-md rounded-none rounded-l-lg animate-slide-in-right'
            : cn(width, 'animate-scale-in')
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--color-border)] p-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-content">{title}</h2>
            {description && (
              <p id="modal-description" className="mt-1 text-sm leading-6 text-content-secondary">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-m-1 rounded-md p-1 text-content-tertiary transition-colors duration-micro hover:bg-surface-raised hover:text-content"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--color-border)] p-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** A drawer is a modal that enters from the side. Same guarantees. */
export function Drawer(props: Omit<Parameters<typeof Modal>[0], 'variant'>) {
  return <Modal {...props} variant="drawer" />;
}
