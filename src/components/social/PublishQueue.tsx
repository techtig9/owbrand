'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The publishing queue.
 *
 * The screen this replaces read `scheduled_posts` — a table nothing ever
 * published from — and showed a status pill with four possible values. Every
 * post in it said "queued" forever, because no worker existed and, even once
 * one did, it read a different table.
 *
 * What matters here is that a post's real state is visible: how many attempts
 * it has used, what the platform actually said, when the next retry is due,
 * and — the honest case — whether anything will publish it at all.
 */

interface QueueJob {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

interface QueuePost {
  id: string;
  platform: string;
  platformLabel: string;
  status: string;
  caption: string | null;
  mediaUrls: string[];
  scheduledFor: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  lastError: string | null;
  createdAt: string;
  job: QueueJob | null;
  willPublish: boolean;
}

type Filter = 'upcoming' | 'published' | 'failed' | 'all';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'published', label: 'Published' },
  { id: 'failed', label: 'Failed' },
  { id: 'all', label: 'All' },
];

export function PublishQueue({ brandId }: { brandId?: string }) {
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [counts, setCounts] = useState({ upcoming: 0, published: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: filter });
      if (brandId) params.set('brandId', brandId);

      const response = await fetch(`/api/scheduler/list-scheduled-posts?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not load the queue.');

      setPosts(data.posts ?? []);
      setCounts(data.counts ?? { upcoming: 0, published: 0, failed: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the queue.');
    } finally {
      setLoading(false);
    }
  }, [filter, brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(post: QueuePost) {
    setBusy(post.id);
    try {
      const response = await fetch('/api/scheduler/cancel-scheduled-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ socialPostId: post.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not cancel the post.');

      toast.success('Cancelled.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the post.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              filter === option.id ? 'bg-ink text-canvas' : 'border border-line text-ink-soft hover:bg-canvas-alt'
            }`}
          >
            {option.label}
            {option.id !== 'all' && (
              <span className="ml-1.5 tabular-nums opacity-70">{counts[option.id as keyof typeof counts]}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" role="status" aria-label="Loading the queue">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-canvas-alt" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm font-semibold text-red-700">{error}</p>
          <button type="button" onClick={() => void load()} className="btn-ghost mt-4">
            Try again
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center">
          <h3 className="font-display text-lg font-semibold text-ink">
            {filter === 'upcoming' ? 'Nothing scheduled' : `No ${filter} posts`}
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
            Generate copy or creative in the studio, then schedule it here. Publishing needs a{' '}
            <Link href="/dashboard/connections" className="font-semibold text-ink underline">
              connected account
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id} className="rounded-2xl border border-line bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={post.status} />
                    <span className="rounded-full bg-canvas-alt px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                      {post.platformLabel}
                    </span>
                    <span className="text-xs text-ink-faint">{describeTiming(post)}</span>
                  </div>

                  {post.caption && (
                    <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-6 text-ink-soft">{post.caption}</p>
                  )}

                  {/* The honest case: a post with no job will never be sent. */}
                  {!post.job && !['published', 'failed', 'cancelled'].includes(post.status) && (
                    <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                      This post has no publishing job, so nothing will send it. Schedule it again.
                    </p>
                  )}

                  {post.job && post.job.attempts > 0 && post.status !== 'published' && (
                    <p className="mt-3 text-xs leading-5 text-ink-soft">
                      Attempt {post.job.attempts} of {post.job.maxAttempts}
                      {post.job.nextAttemptAt && ` · next try ${new Date(post.job.nextAttemptAt).toLocaleString()}`}
                    </p>
                  )}

                  {(post.lastError || post.job?.errorMessage) && (
                    <p
                      role="note"
                      className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700"
                    >
                      {post.lastError ?? post.job?.errorMessage}
                      {/* A credential problem is fixable by the user, so link it. */}
                      {isReconnectError(post) && (
                        <>
                          {' '}
                          <Link href="/dashboard/connections" className="font-semibold underline">
                            Reconnect the account
                          </Link>
                          .
                        </>
                      )}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  {post.externalUrl && (
                    <a
                      href={post.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-canvas-alt"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      View post
                    </a>
                  )}

                  {['draft', 'awaiting_approval', 'scheduled', 'queued'].includes(post.status) && (
                    <button
                      type="button"
                      onClick={() => void cancel(post)}
                      disabled={busy === post.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === post.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Recognises a credential failure from the worker's error code.
 *
 * Keyed on the stable code rather than the message, which is the platform's
 * own text and changes without notice.
 */
function isReconnectError(post: QueuePost): boolean {
  const code = post.job?.errorCode ?? '';
  return /auth|permission|reconnect|credential|no_connected_account|account_/i.test(code);
}

function describeTiming(post: QueuePost): string {
  if (post.publishedAt) return `published ${new Date(post.publishedAt).toLocaleString()}`;
  if (post.scheduledFor) {
    const when = new Date(post.scheduledFor);
    return when.getTime() > Date.now()
      ? `scheduled ${when.toLocaleString()}`
      : `due since ${when.toLocaleString()}`;
  }
  return `created ${new Date(post.createdAt).toLocaleDateString()}`;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; icon: typeof Clock }> = {
    published: { label: 'Published', className: 'bg-mint-50 text-mint-600', icon: CheckCircle2 },
    publishing: { label: 'Publishing', className: 'bg-canvas-alt text-ink-soft', icon: Loader2 },
    scheduled: { label: 'Scheduled', className: 'bg-lavender-200 text-ink', icon: Clock },
    queued: { label: 'Queued', className: 'bg-lavender-200 text-ink', icon: Clock },
    failed: { label: 'Failed', className: 'bg-red-50 text-red-700', icon: AlertTriangle },
    cancelled: { label: 'Cancelled', className: 'bg-canvas-alt text-ink-faint', icon: XCircle },
    draft: { label: 'Draft', className: 'bg-canvas-alt text-ink-soft', icon: Clock },
    awaiting_approval: { label: 'Awaiting approval', className: 'bg-amber-50 text-amber-800', icon: Clock },
  };

  const entry = map[status] ?? { label: status, className: 'bg-canvas-alt text-ink-soft', icon: Clock };
  const Icon = entry.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${entry.className}`}
    >
      <Icon className={`h-3 w-3 ${status === 'publishing' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {entry.label}
    </span>
  );
}
