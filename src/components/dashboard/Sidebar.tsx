'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS, isNavItemActive, navItemsForGroup } from './nav-items';

/**
 * The application sidebar.
 *
 * Replaces a single 1,244-character minified line. Beyond being unreadable,
 * that version hard-coded its own nav list — so Approvals and Connections had
 * to be hand-added to it separately from anywhere else that needed them.
 * The list now comes from `nav-items.ts`, shared with the command palette and
 * the mobile drawer.
 *
 * Accessibility:
 *   - A real `<nav>` with an accessible name, so it is a landmark.
 *   - `aria-current="page"` on the active link, which is how a screen reader
 *     announces where you are. Styling the active item is not enough.
 *   - Group headings are rendered, not implied by spacing.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-[color:var(--color-border)] bg-surface lg:flex">
      <div className="flex h-14 items-center px-5">
        <Link
          href="/"
          className="font-display text-lg font-bold tracking-tight text-content"
        >
          owbrand<span className="text-primary">.</span>
        </Link>
      </div>

      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 pb-6">
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
                      {/*
                        A destination that does not exist is shown disabled
                        rather than linked. A nav link to a 404 is worse than
                        an honest "not yet".
                      */}
                      <span
                        aria-disabled="true"
                        title="Not available yet"
                        className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-content-tertiary opacity-60"
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
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
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-micro ${
                        active
                          ? 'bg-primary-subtle text-primary-on-subtle'
                          : 'text-content-secondary hover:bg-surface-raised hover:text-content'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
