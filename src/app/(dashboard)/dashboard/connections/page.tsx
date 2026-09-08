import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { ConnectionsPanel } from '@/components/social/ConnectionsPanel';

export const dynamic = 'force-dynamic';

/** Human-readable outcomes for the codes the OAuth callback redirects with. */
const CALLBACK_MESSAGES: Record<string, string> = {
  declined: 'You cancelled the connection at Meta. Nothing was changed.',
  invalid_callback: 'That connection link was incomplete. Start the connection again.',
  state_rejected:
    'That connection link was no longer valid — it may have expired or already been used. Start again.',
  not_configured: 'Social publishing is not configured on this server.',
  token_invalid: 'Meta reported the new credential as invalid. Try connecting again.',
  no_pages:
    'Your Facebook account does not administer any Pages. OwBrand publishes to Pages and to Instagram business accounts linked to them, not to personal profiles.',
  exchange_failed: 'We could not complete the connection with Meta. Try again in a moment.',
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: { brand?: string; social_error?: string; social_connected?: string; social_notice?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = supabaseAdmin();
  const accessible = await accessibleBrandIds(user.id, db);

  const requested = searchParams.brand;
  const brandId = requested && accessible.includes(requested) ? requested : undefined;

  // Only render messages from a fixed table — never reflect the query string,
  // which is attacker-controllable via a crafted link.
  const errorMessage = searchParams.social_error ? CALLBACK_MESSAGES[searchParams.social_error] : undefined;
  const connectedCount = Number(searchParams.social_connected);
  const showConnected = Number.isFinite(connectedCount) && connectedCount > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="section-eyebrow">Connections</p>
        <h1 className="mt-3 font-display text-3xl font-bold">Connected accounts</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          OwBrand publishes and schedules through these. Nothing is posted anywhere you have not connected.
        </p>
      </div>

      {errorMessage && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-semibold text-red-700">{errorMessage}</p>
        </div>
      )}

      {/* An unrecognised code means a hand-edited or stale URL. Say so rather
          than echoing whatever was passed. */}
      {searchParams.social_error && !errorMessage && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-semibold text-red-700">
            That connection attempt did not complete. Start the connection again.
          </p>
        </div>
      )}

      {showConnected && (
        <div role="status" className="rounded-2xl border border-mint-300 bg-mint-50 px-5 py-4">
          <p className="text-sm font-semibold text-ink">
            Connected {connectedCount} account{connectedCount === 1 ? '' : 's'}.
          </p>
          {searchParams.social_notice === 'no_instagram_business_account' && (
            <p className="mt-1 text-xs leading-5 text-ink-soft">
              No Instagram business account was linked to those Pages, so only Facebook publishing is available.
              Link one in the Meta Business Suite, then reconnect.
            </p>
          )}
        </div>
      )}

      <ConnectionsPanel brandId={brandId} />

      <p className="text-xs text-ink-faint">
        Looking for your queue?{' '}
        <Link href="/dashboard/scheduler" className="font-semibold text-ink underline">
          Scheduler
        </Link>
      </p>
    </div>
  );
}
