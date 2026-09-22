'use client';

import { useCallback, useId, useRef } from 'react';
import { cn } from './cn';

/**
 * Tabs implementing the ARIA tabs pattern.
 *
 * The keyboard behaviour is the whole point, and it is what every hand-rolled
 * "tab" strip in this codebase was missing. A row of buttons that swaps content
 * looks like tabs and behaves like a toolbar: Tab stops on each one, arrow keys
 * do nothing, and there is no relationship announced between a tab and the
 * panel it controls.
 *
 * This uses roving tabindex — exactly one tab is in the tab order, and Left /
 * Right / Home / End move between them — so a keyboard user reaches the tab
 * strip in one Tab press and then steps through panels, instead of tabbing
 * through every tab to reach the content.
 */

/*
 * Hoisted out of the component so they are stable across renders. Defined
 * inside, they were fresh closures every render, which made them dishonest
 * effect dependencies -- the choice was then between an eslint-disable and a
 * useCallback that recreated itself constantly. Pure functions of their
 * arguments have neither problem.
 */
const tabDomId = (base: string, id: string) => `${base}-tab-${id}`;
const panelDomId = (base: string, id: string) => `${base}-panel-${id}`;

export interface TabItem {
  id: string;
  label: string;
  /** Optional count or status shown after the label. */
  badge?: React.ReactNode;
  disabled?: boolean;
}

export function Tabs({
  items,
  value,
  onChange,
  children,
  className,
  label,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** The panel body for the active tab. */
  children: React.ReactNode;
  className?: string;
  /** Names the tab list. Required: "Tabs" is not a description. */
  label: string;
}) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const tabId = (id: string) => tabDomId(baseId, id);
  const panelId = (id: string) => panelDomId(baseId, id);

  const focusTab = useCallback(
    (index: number) => {
      const enabled = items.filter((i) => !i.disabled);
      if (enabled.length === 0) return;

      // Wrap around, and skip disabled tabs rather than landing on them.
      const next = enabled[((index % enabled.length) + enabled.length) % enabled.length];
      onChange(next.id);
      listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabDomId(baseId, next.id))}`)?.focus();
    },
    // Calls the hoisted helper rather than the local closure, so the
    // dependency list is complete and honest with no suppression.
    [items, onChange, baseId]
  );

  function onKeyDown(event: React.KeyboardEvent) {
    const enabled = items.filter((i) => !i.disabled);
    const current = enabled.findIndex((i) => i.id === value);

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusTab(current + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusTab(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTab(0);
        break;
      case 'End':
        event.preventDefault();
        focusTab(enabled.length - 1);
        break;
    }
  }

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-[color:var(--color-border)]"
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              id={tabId(item.id)}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId(item.id)}
              // Roving tabindex: only the selected tab is reachable by Tab.
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              className={cn(
                'relative shrink-0 px-3 py-2 text-sm font-medium transition-colors duration-micro',
                'disabled:cursor-not-allowed disabled:opacity-50',
                selected ? 'text-primary' : 'text-content-secondary hover:text-content'
              )}
            >
              {item.label}
              {item.badge != null && (
                <span className="ml-1.5 tabular-nums text-xs text-content-tertiary">{item.badge}</span>
              )}
              {/* The active marker is a real element, so the selected state is
                  not carried by text colour alone. */}
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>

      <div id={panelId(value)} role="tabpanel" aria-labelledby={tabId(value)} tabIndex={0} className="pt-5">
        {children}
      </div>
    </div>
  );
}
