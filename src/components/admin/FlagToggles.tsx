'use client';

import { useState } from 'react';
import { Badge, Card } from '@/components/ui';

interface Flag {
  key: string;
  description: string;
  enabled: boolean;
  enabled_for: string[];
  updated_at: string;
}

/**
 * The flag switches.
 *
 * Optimistic, and reverted on failure. A toggle that waits on a round trip
 * feels broken, but one that stays flipped after the request failed is a lie
 * about the state of production — which during an incident is the worst
 * possible time to be lied to.
 */
export function FlagToggles({ flags }: { flags: Flag[] }) {
  const [state, setState] = useState(flags);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: string, next: boolean) {
    const previous = state;
    setBusy(key);
    setError(null);
    setState((current) => current.map((flag) => (flag.key === key ? { ...flag, enabled: next } : flag)));

    try {
      const response = await fetch('/api/admin/flags', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, enabled: next }),
      });
      if (!response.ok) throw new Error('Update failed.');
    } catch {
      // Reverted, so the screen never claims a change that did not land.
      setState(previous);
      setError(`Could not change "${key}". The flag is unchanged.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      {error && (
        <p role="alert" className="border-b border-[color:var(--color-border)] px-5 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <ul className="divide-y divide-[color:var(--color-border)]">
        {state.map((flag) => (
          <li key={flag.key} className="flex flex-wrap items-start gap-4 p-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-sm font-semibold text-ink">{flag.key}</code>
                {flag.enabled_for.length > 0 && (
                  /* A targeted rollout is invisible from the on/off state
                     alone, and an admin turning a flag "off" needs to know
                     some accounts still see it. */
                  <Badge tone="info">{flag.enabled_for.length} targeted</Badge>
                )}
              </div>
              <p className="mt-1 text-sm leading-6 text-content-secondary">{flag.description}</p>
            </div>

            <label className="flex shrink-0 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={flag.enabled}
                disabled={busy === flag.key}
                onChange={(event) => void toggle(flag.key, event.target.checked)}
                className="h-4 w-4 rounded border-line"
              />
              {/* The state is a word, not only a switch position. */}
              <span className="text-sm font-medium text-content">
                {flag.enabled ? 'On' : 'Off'}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
