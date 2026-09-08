'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Link2, Loader2, Lock, Unlink } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Connected social accounts.
 *
 * The screen is built around telling the truth about four different states
 * that all used to look identical:
 *
 *   connected & healthy      — will publish
 *   expiring                 — will publish, but reconnect soon
 *   needs reconnect          — will NOT publish, and why
 *   platform unavailable     — OwBrand cannot publish here at all
 *
 * The old settings page listed rows from `social_accounts` with a green dot,
 * and every one of those rows held the string `placeholder_token_for_…`. A
 * user had no way to know publishing could never work.
 */

interface Account {
  id: string;
  platform: string;
  label: string;
  accountName: string | null;
  brandId: string | null;
  status: 'active' | 'expiring' | 'needs_reconnect' | 'revoked' | 'error';
  usable: boolean;
  expiresInDays: number | null;
  missingScopes: string[];
  lastError: string | null;
  connectedAt: string;
  hasStoredCredential: boolean;
}

interface PlatformInfo {
  platform: string;
  label: string;
  publishSupported: boolean;
  oauthProvider: string | null;
  unavailableReason: string | null;
  connectedCount: number;
}

export function ConnectionsPanel({ brandId }: { brandId?: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [oauthConfigured, setOauthConfigured] = useState<{ meta: boolean }>({ meta: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = brandId ? `/api/social/accounts?brandId=${encodeURIComponent(brandId)}` : '/api/social/accounts';
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not load connected accounts.');

      setAccounts(data.accounts ?? []);
      setPlatforms(data.platforms ?? []);
      setOauthConfigured(data.oauthConfigured ?? { meta: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load connected accounts.');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Starts the OAuth flow.
   *
   * The server mints the state and builds the provider URL — the browser only
   * follows it. Nothing here constructs an authorization URL, which is what
   * makes the state binding meaningful.
   */
  async function connect() {
    setBusy('connect');
    try {
      const params = new URLSearchParams({ provider: 'meta', returnTo: '/dashboard/connections' });
      if (brandId) params.set('brandId', brandId);

      const response = await fetch(`/api/social/oauth/start?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not start the connection.');

      window.location.href = data.authorizationUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the connection.');
      setBusy(null);
    }
  }

  async function disconnect(account: Account) {
    setBusy(account.id);
    try {
      const response = await fetch('/api/social/accounts', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: account.id, revokeAtProvider: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not disconnect the account.');

      toast.success(`${account.label} disconnected.`);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect the account.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading connections">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-raised" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-danger bg-danger-subtle p-6">
        <p className="text-sm font-semibold text-danger">{error}</p>
        <button type="button" onClick={() => void load()} className="btn-ghost mt-4">
          Try again
        </button>
      </div>
    );
  }

  const metaPlatforms = platforms.filter((p) => p.oauthProvider === 'meta');
  const unavailable = platforms.filter((p) => !p.publishSupported);

  return (
    <div className="space-y-6">
      {!oauthConfigured.meta && (
        <div role="note" className="rounded-2xl border border-warning bg-warning-subtle px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">Not configured</p>
          <p className="mt-1 text-sm leading-6 text-content-secondary">
            This server has no Meta credentials, so accounts cannot be connected. An operator needs to set{' '}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">META_APP_ID</code>,{' '}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">META_APP_SECRET</code> and{' '}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">TOKEN_ENCRYPTION_KEY</code>.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Facebook &amp; Instagram</h2>
            <p className="mt-1 max-w-xl text-sm text-content-secondary">
              One authorisation covers both. OwBrand connects each Facebook Page you administer, plus any
              Instagram business account linked to one.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={!oauthConfigured.meta || busy === 'connect'}
            className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'connect' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="h-4 w-4" aria-hidden="true" />
            )}
            {accounts.length > 0 ? 'Connect more' : 'Connect'}
          </button>
        </div>

        {accounts.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-line bg-surface-raised px-4 py-6 text-center text-sm text-content-tertiary">
            No accounts connected yet. Publishing and scheduling need at least one.
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {accounts.map((account) => (
              <li key={account.id} className="rounded-xl border border-line px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {account.accountName ?? account.label}
                      <StatusBadge account={account} />
                    </p>
                    <p className="mt-0.5 text-xs text-content-tertiary">
                      {account.label} · connected {new Date(account.connectedAt).toLocaleDateString()}
                      {account.expiresInDays !== null &&
                        account.expiresInDays > 0 &&
                        ` · renews in ${account.expiresInDays} day${account.expiresInDays === 1 ? '' : 's'}`}
                    </p>

                    {account.missingScopes.length > 0 && (
                      <p className="mt-2 text-xs leading-5 text-danger">
                        Missing permission{account.missingScopes.length === 1 ? '' : 's'}:{' '}
                        <span className="font-mono">{account.missingScopes.join(', ')}</span>. Reconnect and grant
                        them to publish.
                      </p>
                    )}

                    {account.lastError && account.missingScopes.length === 0 && (
                      <p className="mt-2 text-xs leading-5 text-content-secondary">{account.lastError}</p>
                    )}

                    {!account.hasStoredCredential && (
                      <p className="mt-2 text-xs leading-5 text-danger">
                        No credential is stored for this account, so it cannot publish. Reconnect it.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {!account.usable && (
                      <button
                        type="button"
                        onClick={() => void connect()}
                        disabled={!oauthConfigured.meta}
                        className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-50"
                      >
                        Reconnect
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void disconnect(account)}
                      disabled={busy === account.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-content-secondary hover:bg-surface-raised disabled:opacity-50"
                    >
                      {busy === account.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Disconnect
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 border-t border-line pt-4 text-[11px] leading-5 text-content-tertiary">
          Disconnecting also asks Meta to revoke OwBrand&rsquo;s access, and destroys the stored credential.
          Access tokens are encrypted before they are saved and are only ever decrypted by the publishing worker.
        </p>
      </section>

      {metaPlatforms.length > 0 && (
        <p className="text-xs text-content-tertiary">
          {metaPlatforms.map((p) => `${p.label}: ${p.connectedCount} connected`).join(' · ')}
        </p>
      )}

      <section className="rounded-2xl border border-line bg-surface-raised p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Lock className="h-4 w-4" aria-hidden="true" />
          Not available yet
        </h2>
        <p className="mt-1 text-sm text-content-secondary">
          These platforms are in the product, but OwBrand cannot publish to them. Each needs its own approved
          developer application, so they are listed here rather than offered as a button that fails.
        </p>
        <ul className="mt-4 space-y-2">
          {unavailable.map((platform) => (
            <li key={platform.platform} className="rounded-xl bg-surface px-4 py-3">
              <p className="text-sm font-semibold text-ink">{platform.label}</p>
              <p className="mt-0.5 text-xs leading-5 text-content-secondary">{platform.unavailableReason}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatusBadge({ account }: { account: Account }) {
  if (account.status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready
      </span>
    );
  }

  if (account.status === 'expiring') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
        <Clock className="h-3 w-3" aria-hidden="true" /> Expiring
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger-subtle px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {account.status === 'needs_reconnect' ? 'Reconnect' : 'Error'}
    </span>
  );
}
