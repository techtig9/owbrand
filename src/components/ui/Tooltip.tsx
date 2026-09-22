'use client';

import { useId, useRef, useState } from 'react';
import { cn } from './cn';

/**
 * A tooltip that is reachable without a mouse.
 *
 * Three rules it follows that `title=""` and most hand-rolled `group-hover`
 * tooltips break:
 *
 *  1. It shows on FOCUS as well as hover. A hover-only tooltip is invisible to
 *     a keyboard user and to anyone on a touch screen.
 *  2. It is referenced with `aria-describedby`, not `aria-label`. A label
 *     REPLACES the control's name; a tooltip is supplementary, and using
 *     aria-label here silently discards the button's own text.
 *  3. Escape dismisses it while focus stays put (WCAG 1.4.13). Content that
 *     appears on hover must be dismissible without moving the pointer, or it
 *     can cover the thing the user was trying to read.
 *
 * It is not a replacement for a visible label. If the information is required
 * to use the control, it belongs on the page.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  content: string;
  children: React.ReactElement;
  side?: 'top' | 'bottom';
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // Do not stopPropagation: a dialog behind this should still be able
          // to close on a second Escape.
          setOpen(false);
        }
      }}
    >
      {/* describedby, never label — see the note above. */}
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>

      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 z-40 w-max max-w-xs -translate-x-1/2 rounded-md px-2 py-1 text-xs font-medium shadow-lg',
            'bg-[color:var(--color-text)] text-[color:var(--color-bg)]',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
