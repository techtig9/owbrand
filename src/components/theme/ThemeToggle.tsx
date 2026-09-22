'use client';

import { useCallback, useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

/**
 * Theme control: light / dark / follow the system.
 *
 * Three states, not two. A two-state toggle forces a choice the moment the
 * user touches it and can never return to following the OS — so someone whose
 * machine switches at sunset loses that the first time they try dark mode.
 * "System" is the default and stores nothing.
 *
 * The stored value and the attribute are the same contract the inline
 * ThemeScript reads before first paint, so there is no flash and no
 * disagreement between what was chosen and what is rendered.
 */

const STORAGE_KEY = 'owbrand-theme';

type ThemeChoice = 'light' | 'dark' | 'system';

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage throws outright in a private window or when site data is
    // blocked. Following the system is the correct fallback.
  }
  return 'system';
}

export function ThemeToggle() {
  /*
   * Starts as 'system' on both server and client so the first render matches,
   * then reconciles in an effect. Reading localStorage during render would
   * produce a hydration mismatch — the server cannot know the stored value.
   */
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setChoice(readStored());
    setMounted(true);
  }, []);

  const apply = useCallback((next: ThemeChoice) => {
    setChoice(next);

    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session even if it cannot persist.
    }

    // Removing the attribute — rather than setting it to 'light' — is what
    // returns control to prefers-color-scheme, because tokens.css keys the
    // media query on `:not([data-theme='light'])`.
    if (next === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
  }, []);

  return (
    <fieldset className="inline-flex items-center gap-0.5 rounded-full border border-[color:var(--color-border)] bg-surface p-0.5">
      <legend className="sr-only">Colour theme</legend>

      {OPTIONS.map((option) => {
        const Icon = option.icon;
        // Before mount nothing is marked active, so the server-rendered markup
        // and the first client render agree.
        const active = mounted && choice === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => apply(option.value)}
            aria-pressed={active}
            title={`${option.label} theme`}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-micro ${
              active
                ? 'bg-primary-subtle text-primary-on-subtle'
                : 'text-content-tertiary hover:bg-surface-raised hover:text-content'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {/* The accessible name, since the icon alone is not one. */}
            <span className="sr-only">{option.label} theme</span>
          </button>
        );
      })}
    </fieldset>
  );
}
