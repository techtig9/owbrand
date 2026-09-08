import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accountHealth, type SocialAccountRow } from '@/lib/social/account-store';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from('social_accounts')
    .select(
      'id, user_id, brand_id, platform, account_name, external_account_id, external_page_id, granted_scopes, token_expires_at, status, last_error, last_error_at, last_verified_at, connected_at, access_token_ciphertext, metadata'
    )
    .eq('user_id', user.id)
    .neq('status', 'revoked');

  const accounts = (data ?? []) as SocialAccountRow[];
  const usable = accounts.filter((account) => accountHealth(account).usable).length;
  const needsAttention = accounts.length - usable;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-soft">Manage your account and connections.</p>
      </div>

      <section className="rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Profile</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-soft">Name</span>
            <input defaultValue={user!.name} className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-soft">Email</span>
            <input defaultValue={user!.email} disabled className="w-full rounded-xl border border-line bg-canvas-alt px-4 py-2.5 text-sm text-ink-faint" />
          </label>
          {/* No handler exists for this yet — profile editing is not built.
              Left visibly disabled rather than looking functional. */}
          <button type="button" disabled className="btn-primary cursor-not-allowed opacity-50">
            Save changes
          </button>
          <p className="text-xs text-ink-faint">Editing your profile is not available yet.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Password</h2>
        <p className="mt-1 text-xs text-ink-soft">Use the &ldquo;forgot password&rdquo; flow to set a new one via email.</p>
        <a href="/forgot-password" className="btn-ghost mt-4 inline-flex">
          Send reset link
        </a>
      </section>

      <section className="rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Connected social accounts</h2>
        {/*
          Previously this listed a row per platform with a green "Connected"
          label derived from the mere existence of a social_accounts row — and
          every one of those rows held a placeholder token, so "Connected" was
          never true. Its Connect button had no handler at all.

          Status now comes from accountHealth(), and connecting happens on the
          Connections screen, which owns the real OAuth flow.
        */}
        <p className="mt-1 text-xs text-ink-soft">
          {accounts.length === 0
            ? 'No accounts connected. Publishing and scheduling need at least one.'
            : `${usable} ready to publish${needsAttention > 0 ? `, ${needsAttention} need attention` : ''}.`}
        </p>
        <Link href="/dashboard/connections" className="btn-ghost mt-4 inline-flex">
          Manage connections
        </Link>
      </section>

      <section className="rounded-2xl border border-blush-300 bg-blush-50 p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Delete account</h2>
        <p className="mt-1 text-xs text-ink-soft">This permanently removes your brands, assets, and subscription.</p>
        {/* Account deletion has no implementation. A button that silently
            does nothing on an irreversible action is worse than no button. */}
        <button
          type="button"
          disabled
          className="mt-4 cursor-not-allowed rounded-full border border-blush-500 px-5 py-2 text-xs font-semibold text-blush-700 opacity-50"
        >
          Delete my account
        </button>
        <p className="mt-2 text-xs text-ink-faint">
          Self-service deletion is not available yet — contact support and we will remove your data.
        </p>
      </section>
    </div>
  );
}
