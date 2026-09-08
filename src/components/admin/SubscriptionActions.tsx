'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function SubscriptionActions({ userId }: { userId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/override-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Action failed.');
        return;
      }
      toast.success('Subscription updated.');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <select
        disabled={loading}
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) run('upgrade', { plan: e.target.value });
          e.target.value = '';
        }}
        className="rounded-full border border-line bg-surface px-2 py-1 text-xs text-content-secondary"
      >
        <option value="" disabled>
          Set plan…
        </option>
        <option value="free">Free</option>
        <option value="starter">Starter</option>
        <option value="pro">Pro</option>
        <option value="business">Business</option>
      </select>
      <button
        type="button"
        disabled={loading}
        onClick={() => run('extend', { extendDays: 30 })}
        className="rounded-full border border-line px-2.5 py-1 text-xs text-content-secondary hover:bg-surface-raised"
      >
        +30 days
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => run('cancel')}
        className="rounded-full border border-primary px-2.5 py-1 text-xs text-primary hover:bg-primary-subtle"
      >
        Cancel
      </button>
    </div>
  );
}
