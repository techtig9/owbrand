'use client';

import { Search, Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export function TopNav({
  userName,
  creditsRemaining,
  monthlyCredits,
}: {
  userName: string;
  creditsRemaining: number;
  monthlyCredits: number;
}) {
  const router = useRouter();
  const unlimited = creditsRemaining < 0;
  const pct = unlimited ? 100 : Math.max(0, Math.min(100, (creditsRemaining / Math.max(monthlyCredits, 1)) * 100));

  async function handleLogout() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <header className="flex items-center gap-4 border-b border-line bg-canvas-card px-6 py-4">
      <div className="flex flex-1 items-center gap-3 rounded-full border border-line bg-canvas px-4 py-2 text-sm text-ink-faint">
        <Search className="h-4 w-4" />
        <input placeholder="Search projects, assets…" className="w-full bg-transparent outline-none placeholder:text-ink-faint" />
      </div>

      <div className="hidden items-center gap-2 rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink-soft sm:flex">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-canvas-alt">
          <div className="h-full rounded-full bg-coral-500" style={{ width: `${pct}%` }} />
        </div>
        {unlimited ? 'Unlimited credits' : `${creditsRemaining.toLocaleString()} credits`}
      </div>

      <button type="button" className="rounded-full p-2 text-ink-soft hover:bg-canvas-alt" aria-label="Notifications">
        <Bell className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blush-100 font-display text-xs font-bold text-ink">
          {userName.slice(0, 1).toUpperCase()}
        </div>
        <button type="button" onClick={handleLogout} className="text-xs font-semibold text-ink-soft hover:text-coral-600">
          Log out
        </button>
      </div>
    </header>
  );
}
