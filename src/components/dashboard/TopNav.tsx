'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Settings, User } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { CommandPalette } from './CommandPalette';
import { MobileNav } from './MobileNav';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

/**
 * The application top bar.
 *
 * Three defects in the version this replaces, all of the same kind — controls
 * that looked functional and were not:
 *
 *   1. A search `<input>` with a placeholder, no label and no handler. It is
 *      now the command palette trigger, which actually navigates.
 *   2. A notifications bell with no handler and nothing behind it. There is no
 *      notification system, so the button is GONE rather than left as a
 *      decoration that teaches users their clicks do nothing.
 *   3. A bare "Log out" text button beside an avatar that did nothing. Now a
 *      real menu with profile, settings and sign-out.
 *
 * The credit meter is kept and made accessible: a `<progress>`-equivalent with
 * `role="meter"` and the value in text, so the number is available without
 * interpreting a bar's width.
 */
export function TopNav({
  userName,
  creditsRemaining,
  monthlyCredits,
}: {
  userName: string;
  creditsRemaining: number;
  monthlyCredits: number;
}) {
  const unlimited = creditsRemaining < 0;
  const percent = unlimited
    ? 100
    : Math.max(0, Math.min(100, (creditsRemaining / Math.max(monthlyCredits, 1)) * 100));

  // Below a quarter remaining, the meter earns a warning colour — paired with
  // the number in text, never colour alone.
  const low = !unlimited && percent <= 25;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[color:var(--color-border)] bg-surface px-4 sm:px-6">
      <MobileNav />

      <CommandPalette />

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {unlimited ? (
          <span className="hidden text-xs font-medium text-content-secondary sm:inline">Unlimited credits</span>
        ) : (
          <Link
            href="/dashboard/billing"
            className="hidden items-center gap-2 rounded-md border border-[color:var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-micro hover:border-[color:var(--color-border-strong)] sm:flex"
          >
            <span
              role="meter"
              aria-valuenow={creditsRemaining}
              aria-valuemin={0}
              aria-valuemax={monthlyCredits}
              aria-label="Credits remaining this period"
              className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-raised"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${percent}%`,
                  backgroundColor: low ? 'var(--color-warning)' : 'var(--color-primary)',
                }}
              />
            </span>
            {/* The value in text, so it never depends on reading a bar. */}
            <span className="tabular-nums">{creditsRemaining.toLocaleString()} credits</span>
          </Link>
        )}

        <ThemeToggle />

        <AccountMenu userName={userName} />
      </div>
    </header>
  );
}

/**
 * The account menu.
 *
 * A disclosure, not a dialog: it does not trap focus, because a menu that
 * traps focus prevents tabbing on past it, which is what a keyboard user
 * expects from a menu. It does close on Escape, on outside click, and on blur
 * leaving the container — the three ways people actually dismiss one.
 */
function AccountMenu({ userName }: { userName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    try {
      await supabaseBrowser().auth.signOut();
      router.push('/');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const initial = userName.trim().slice(0, 1).toUpperCase() || 'U';

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-md p-1 transition-colors duration-micro hover:bg-surface-raised"
      >
        <span
          className="grid h-7 w-7 place-items-center rounded-full bg-primary-subtle text-xs font-bold text-primary-on-subtle"
          aria-hidden="true"
        >
          {initial}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-content-tertiary" aria-hidden="true" />
        {/* The accessible name: an avatar initial is not one. */}
        <span className="sr-only">Account menu for {userName}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="glass-floating absolute right-0 top-full z-40 mt-1.5 w-52 overflow-hidden p-1 animate-scale-in"
        >
          <p className="truncate px-3 py-2 text-xs text-content-tertiary">
            Signed in as <span className="font-medium text-content">{userName}</span>
          </p>

          <Link
            href="/dashboard/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-content transition-colors duration-micro hover:bg-surface-raised"
          >
            <User className="h-4 w-4" aria-hidden="true" />
            Profile
          </Link>

          <Link
            href="/dashboard/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-content transition-colors duration-micro hover:bg-surface-raised"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-content transition-colors duration-micro hover:bg-surface-raised disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
