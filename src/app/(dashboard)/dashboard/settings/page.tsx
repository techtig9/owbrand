import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accountHealth, type SocialAccountRow } from '@/lib/social/account-store';
import { DangerZone } from '@/components/dashboard/DangerZone';
import { ApiKeys } from '@/components/dashboard/ApiKeys';
import { Webhooks } from '@/components/dashboard/Webhooks';

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
        <p className="mt-1 text-sm text-content-secondary">Manage your account and connections.</p>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Profile</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-content-secondary">Name</span>
            <input
              defaultValue={user!.name}
              className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-content-secondary">Email</span>
            <input
              defaultValue={user!.email}
              disabled
              className="w-full rounded-xl border border-line bg-surface-raised px-4 py-2.5 text-sm text-content-tertiary"
            />
          </label>
          {/* No handler exists for this yet — profile editing is not built.
              Left visibly disabled rather than looking functional. */}
          <button type="button" disabled className="btn-primary cursor-not-allowed opacity-50">
            Save changes
          </button>
          <p className="text-xs text-content-tertiary">Editing your profile is not available yet.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Password</h2>
        <p className="mt-1 text-xs text-content-secondary">
          Use the &ldquo;forgot password&rdquo; flow to set a new one via email.
        </p>
        <a href="/forgot-password" className="btn-ghost mt-4 inline-flex">
          Send reset link
        </a>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Connected social accounts</h2>
        {/*
          Previously this listed a row per platform with a green "Connected"
          label derived from the mere existence of a social_accounts row — and
          every one of those rows held a placeholder token, so "Connected" was
          never true. Its Connect button had no handler at all.

          Status now comes from accountHealth(), and connecting happens on the
          Connections screen, which owns the real OAuth flow.
        */}
        <p className="mt-1 text-xs text-content-secondary">
          {accounts.length === 0
            ? 'No accounts connected. Publishing and scheduling need at least one.'
            : `${usable} ready to publish${needsAttention > 0 ? `, ${needsAttention} need attention` : ''}.`}
        </p>
        <Link href="/dashboard/connections" className="btn-ghost mt-4 inline-flex">
          Manage connections
        </Link>
      </section>

      <ApiKeys />

      <Webhooks />

      {/*
        Deletion and export are real as of Phase 7. This section previously
        rendered a disabled button beside a privacy policy that stated deletion
        was available here — a false claim in a legal document.
      */}
      <DangerZone email={user!.email} />
    </div>
  );
}
