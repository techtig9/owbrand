'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { NAV_ITEMS, type NavItem } from './nav-items';

/**
 * Command palette, opened with Cmd/Ctrl-K.
 *
 * Spec section 4 asks for a search/command surface in the top bar. What was
 * there was an `<input>` with a placeholder, no label, and no handler — it
 * looked like search and did nothing, which is worse than no search at all.
 *
 * Accessibility is the substance of this component, not decoration:
 *
 *   - It is a modal dialog, so it takes `role="dialog"` and `aria-modal`, and
 *     focus is TRAPPED inside it. Without the trap, Tab walks into the page
 *     behind an overlay a screen-reader user cannot see past.
 *   - Focus RETURNS to whatever opened it on close (WCAG 2.4.3 Focus Order).
 *     Losing focus to the top of the document is the most common dialog bug.
 *   - The combobox pattern: the input keeps focus while arrow keys move a
 *     virtual selection, announced through `aria-activedescendant`. Moving DOM
 *     focus to each option instead would stop the user typing.
 *   - Escape closes, and the click-away target is a real button so it is
 *     reachable without a pointer.
 */

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** The element that had focus before opening, so it can be restored. */
  const openerRef = useRef<HTMLElement | null>(null);

  // Planned destinations are excluded: offering a command that leads nowhere
  // is the same defect as a nav link to a 404.
  const commands = useMemo(() => NAV_ITEMS.filter((item) => !item.planned), []);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;

    const scored = commands
      .map((item) => ({ item, score: scoreCommand(item, term) }))
      .filter((entry) => entry.score > 0)
      // Higher score first; ties keep the nav's own order, which is
      // meaningful — Overview should outrank a deep page on a vague query.
      .sort((a, b) => b.score - a.score);

    return scored.map((entry) => entry.item);
  }, [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    // Restore focus to the opener, or the body if it has since been removed.
    openerRef.current?.focus?.();
  }, []);

  const openPalette = useCallback(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  /* --- Global shortcut ------------------------------------------------ */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isToggle = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isToggle) return;

      // Cmd-K is ours, so stop the browser's own binding for it.
      event.preventDefault();
      if (open) close();
      else openPalette();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close, openPalette]);

  /* --- Focus on open -------------------------------------------------- */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /* --- Focus trap ----------------------------------------------------- */
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap at both ends. Only handling the forward direction is the common
      // half-fix, and Shift-Tab then escapes the dialog immediately.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /* --- Keep the active option in view --------------------------------- */
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, results.length]);

  function run(item: NavItem) {
    close();
    router.push(item.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[activeIndex];
      if (item) run(item);
    }
  }

  return (
    <>
      {/*
        The trigger. A button, not a fake input: it opens a dialog, so it must
        announce itself as a button and be operable with Enter and Space.
      */}
      <button
        type="button"
        onClick={openPalette}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[color:var(--color-border)] bg-surface px-3 py-2 text-left text-sm text-content-tertiary transition-colors duration-micro hover:border-[color:var(--color-border-strong)] sm:max-w-md"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Search or jump to…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-[color:var(--color-border)] bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-content-tertiary sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
          {/* Dismiss layer. A button so it is not pointer-only. */}
          <button
            type="button"
            aria-label="Close the command palette"
            onClick={close}
            className="absolute inset-0 cursor-default bg-black/40"
          />

          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="glass-floating relative z-10 w-full max-w-lg overflow-hidden animate-scale-in"
          >
            <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-content-tertiary" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search pages…"
                // The combobox contract. `aria-activedescendant` is what lets
                // the input keep focus while the selection moves.
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                aria-autocomplete="list"
                aria-activedescendant={results[activeIndex] ? `command-option-${activeIndex}` : undefined}
                // An accessible name that does not depend on the placeholder,
                // which assistive technology may not expose.
                aria-label="Search pages"
                className="w-full bg-transparent text-sm text-content outline-none placeholder:text-content-tertiary"
              />
            </div>

            <ul
              ref={listRef}
              id="command-palette-list"
              role="listbox"
              aria-label="Pages"
              className="max-h-80 overflow-y-auto p-2"
            >
              {results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-content-tertiary">
                  Nothing matches “{query}”.
                </li>
              )}

              {results.map((item, index) => {
                const Icon = item.icon;
                const active = index === activeIndex;

                return (
                  <li key={`${item.href}-${item.label}`} role="none">
                    <button
                      type="button"
                      id={`command-option-${index}`}
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      onClick={() => run(item)}
                      onPointerMove={() => setActiveIndex(index)}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-micro ${
                        active ? 'bg-primary-subtle text-primary-on-subtle' : 'text-content hover:bg-surface-raised'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1 truncate font-medium">{item.label}</span>
                      <span className="shrink-0 text-xs text-content-tertiary">{item.group}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Ranks a command against the query.
 *
 * A label prefix beats a label substring beats a keyword hit, so typing "an"
 * surfaces Analytics rather than a page that merely mentions it. Returning 0
 * excludes the item, which keeps the filter and the ranking in one pass.
 */
function scoreCommand(item: NavItem, term: string): number {
  const label = item.label.toLowerCase();

  if (label === term) return 100;
  if (label.startsWith(term)) return 80;
  if (label.includes(term)) return 60;

  for (const keyword of item.keywords ?? []) {
    const value = keyword.toLowerCase();
    if (value.startsWith(term)) return 40;
    if (value.includes(term)) return 20;
  }

  if (item.group.toLowerCase().includes(term)) return 10;

  return 0;
}
