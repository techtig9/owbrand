'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { NAV_GROUPS, isNavItemActive, navItemsForGroup } from './nav-items';

/**
 * Navigation below the `lg` breakpoint.
 *
 * Spec section 16 says mobile must be intentionally designed. The previous
 * shell simply hid the sidebar (`hidden lg:flex`) with nothing in its place —
 * so on a phone the entire application was unreachable except by typing URLs.
 *
 * Implemented as a drawer dialog with the same focus discipline as the command
 * palette: focus moves in on open, is trapped while open, and returns to the
 * trigger on close. Route changes close it, otherwise the drawer stays over
 * the page the user just navigated to.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    // Focus the panel itself rather than the first link, so a screen reader
    // announces the dialog before reading its contents.
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    // The page behind a drawer must not scroll — otherwise a swipe moves the
    // wrong layer and the drawer appears to drift.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label="Open navigation"
        className="rounded-md p-2 text-content-secondary transition-colors duration-micro hover:bg-surface-raised hover:text-content lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/40"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="relative z-10 h-full w-72 max-w-[85vw] overflow-y-auto border-r border-[color:var(--color-border)] bg-surface outline-none animate-slide-up"
          >
            <div className="flex h-14 items-center justify-between px-5">
              <Link href="/" className="font-display text-lg font-bold text-content">
                owbrand<span className="text-primary">.</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label="Close navigation"
                className="rounded-md p-2 text-content-secondary hover:bg-surface-raised"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Main navigation" className="px-3 pb-8">
              {NAV_GROUPS.map((group) => (
                <div key={group} className="mb-5">
                  <h2 className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-content-tertiary">
                    {group}
                  </h2>
                  <ul className="space-y-0.5">
                    {navItemsForGroup(group).map((item) => {
                      const Icon = item.icon;
                      const active = isNavItemActive(item, pathname);

                      if (item.planned) {
                        return (
                          <li key={`${item.href}-${item.label}`}>
                            <span
                              aria-disabled="true"
                              className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2.5 text-sm text-content-tertiary opacity-60"
                            >
                              <Icon className="h-4 w-4" aria-hidden="true" />
                              {item.label}
                            </span>
                          </li>
                        );
                      }

                      return (
                        <li key={`${item.href}-${item.label}`}>
                          <Link
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                            className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium ${
                              active
                                ? 'bg-primary-subtle text-primary-on-subtle'
                                : 'text-content-secondary hover:bg-surface-raised hover:text-content'
                            }`}
                          >
                            <Icon className="h-4 w-4" aria-hidden="true" />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
