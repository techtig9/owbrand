'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The approval inbox.
 *
 * Shows what the factuality guard flagged, and makes resolving it a deliberate
 * act. Blocking findings are listed individually with the exact excerpt that
 * triggered them, because "approve everything" on a medical claim is precisely
 * the outcome the guard exists to prevent.
 */

interface Finding {
  id: string;
  severity: 'block' | 'review';
  category: string;
  excerpt: string;
  explanation: string;
}

interface InboxItem {
  asset: {
    id: string;
    brandId: string;
    type: string;
    status: string;
    caption: string | null;
    createdAt: string;
  };
  findings: Finding[];
  blocked: boolean;
}

export function ApprovalInbox({ brandId }: { brandId?: string }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState({ pending: 0, blocked: 0, review: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = brandId ? `/api/approvals?brandId=${encodeURIComponent(brandId)}` : '/api/approvals';
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not load the inbox.');

      setItems(data.items ?? []);
      setCounts(data.counts ?? { pending: 0, blocked: 0, review: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the inbox.');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: InboxItem, decision: 'approve' | 'reject' | 'request_edits') {
    // Approving flagged content requires an explicit acknowledgement — the
    // reviewer is stating they read each finding.
    if (decision === 'approve' && item.blocked && !acknowledged[item.asset.id]) {
      toast.error('Confirm you have reviewed the blocking findings first.');
      return;
    }

    setActing(item.asset.id);
    try {
      const response = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: item.asset.id,
          decision,
          resolveFindings: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not record that decision.');

      toast.success(
        decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Sent back for edits'
      );
      setItems((current) => current.filter((i) => i.asset.id !== item.asset.id));
      setCounts((current) => ({
        pending: Math.max(0, current.pending - 1),
        blocked: Math.max(0, current.blocked - (item.blocked ? 1 : 0)),
        review: Math.max(0, current.review - (item.blocked ? 0 : 1)),
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record that decision.');
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading approvals">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl bg-surface-raised" />
        ))}
        <span className="sr-only">Loading approvals…</span>
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

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface px-6 py-20 text-center">
        <span className="rounded-2xl bg-success-subtle p-3">
          <ShieldCheck className="h-6 w-6 text-success" aria-hidden="true" />
        </span>
        <h3 className="mt-4 font-display text-lg font-semibold text-ink">Nothing waiting</h3>
        <p className="mt-2 max-w-sm text-sm text-content-secondary">
          Generated content with factuality findings will appear here for review before it can be published.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Stat label="Awaiting review" value={counts.pending} />
        <Stat label="Blocking" value={counts.blocked} tone="danger" />
        <Stat label="Advisory" value={counts.review} tone="warning" />
      </div>

      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.asset.id} className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-content-secondary">
                    {item.asset.type}
                  </span>
                  {item.blocked ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-danger-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-danger">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Blocking
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning">
                      <Info className="h-3 w-3" aria-hidden="true" /> Review
                    </span>
                  )}
                </div>
                {item.asset.caption && (
                  <p className="mt-3 line-clamp-3 max-w-2xl text-sm leading-6 text-content-secondary">
                    {item.asset.caption}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {item.findings.map((finding) => (
                <div
                  key={finding.id}
                  className={`rounded-xl border px-3 py-2.5 ${
                    finding.severity === 'block'
                      ? 'border-danger bg-danger-subtle'
                      : 'border-warning bg-warning-subtle'
                  }`}
                >
                  <p
                    className={`text-xs font-semibold uppercase tracking-wide ${
                      finding.severity === 'block' ? 'text-danger' : 'text-warning'
                    }`}
                  >
                    {finding.category.replace(/_/g, ' ')}
                  </p>
                  <p className="mt-1 text-sm text-ink">
                    <span className="font-medium">“{finding.excerpt}”</span>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-content-secondary">{finding.explanation}</p>
                </div>
              ))}
            </div>

            {item.blocked && (
              <label className="mt-4 flex items-start gap-2 text-xs text-content-secondary">
                <input
                  type="checkbox"
                  checked={Boolean(acknowledged[item.asset.id])}
                  onChange={(event) =>
                    setAcknowledged((current) => ({ ...current, [item.asset.id]: event.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-line"
                />
                <span>
                  I have reviewed each blocking finding above and confirm this copy is accurate and permitted for
                  this brand.
                </span>
              </label>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void decide(item, 'approve')}
                disabled={acting === item.asset.id || (item.blocked && !acknowledged[item.asset.id])}
                className="btn-primary !px-4 !py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {acting === item.asset.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Approve
              </button>

              <button
                type="button"
                onClick={() => void decide(item, 'request_edits')}
                disabled={acting === item.asset.id}
                className="btn-ghost !px-4 !py-2 text-xs disabled:opacity-50"
              >
                Request edits
              </button>

              <button
                type="button"
                onClick={() => void decide(item, 'reject')}
                disabled={acting === item.asset.id}
                className="inline-flex items-center gap-2 rounded-full border border-danger px-4 py-2 text-xs font-semibold text-danger hover:bg-danger-subtle disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'warning' }) {
  const toneClass =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink';

  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-content-tertiary">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}
