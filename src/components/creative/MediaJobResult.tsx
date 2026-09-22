'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { MediaJobResponse } from './types';

/**
 * Media generation is asynchronous, so this component tracks the job rather
 * than pretending the response is the result.
 *
 * The video route deliberately returns `running` when the provider has accepted
 * a render but not finished it, and never fabricates an output URL. This polls
 * /api/jobs/create for the real state; if the render never completes, the UI
 * keeps saying "rendering", which is the truth.
 */

const POLL_INTERVAL_MS = 4000;
/** Stop after ~10 minutes rather than polling a dead job forever. */
const MAX_POLLS = 150;

interface JobState {
  state: 'queued' | 'running' | 'completed' | 'failed';
  progress: number | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

export function MediaJobResult({ initial, kind }: { initial: MediaJobResponse; kind: 'photo' | 'video' }) {
  const terminal = initial.state === 'completed' || initial.state === 'failed';

  const [job, setJob] = useState<JobState>({
    state: initial.state,
    progress: initial.state === 'completed' ? 100 : null,
    error: null,
    result: null,
  });
  const [polls, setPolls] = useState(0);

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/jobs/create?jobId=${encodeURIComponent(initial.jobId)}`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.job) {
        setJob({
          state: data.job.state,
          progress: data.job.progress ?? null,
          error: data.job.error ?? null,
          result: data.job.result ?? null,
        });
      }
    } catch {
      // A failed poll is not a failed job — leave the last known state alone.
    }
  }, [initial.jobId]);

  useEffect(() => {
    if (terminal || job.state === 'completed' || job.state === 'failed') return;
    if (polls >= MAX_POLLS) return;

    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      void poll();
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [terminal, job.state, polls, poll]);

  const assets = initial.assets ?? (job.result?.assets as MediaJobResponse['assets']) ?? [];
  const outputUrl = initial.outputUrl ?? ((job.result?.outputUrl as string | undefined) ?? null);
  const stalled = polls >= MAX_POLLS && job.state !== 'completed' && job.state !== 'failed';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <StateBadge state={job.state} />
          <span className="text-xs text-content-tertiary">Job {initial.jobId.slice(0, 8)}</span>
          {initial.deduplicated && (
            <span className="rounded-full bg-surface-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-content-secondary">
              already requested
            </span>
          )}
          {initial.provider && <span className="text-xs text-content-tertiary">{initial.provider}</span>}
        </div>

        {typeof job.progress === 'number' && job.state !== 'completed' && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-raised">
            <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${job.progress}%` }} />
          </div>
        )}

        {job.error && (
          <p role="alert" className="mt-3 rounded-xl border border-danger bg-danger-subtle px-3 py-2 text-xs text-danger">
            {job.error}
          </p>
        )}

        {stalled && (
          <p className="mt-3 text-xs leading-5 text-content-secondary">
            Still rendering after 10 minutes. The job is persisted — reopen this page later, or check the job
            record. The completion worker that finalises long renders is delivered in Phase 3.
          </p>
        )}

        {initial.note && !job.error && <p className="mt-3 text-xs leading-5 text-content-secondary">{initial.note}</p>}
      </div>

      {kind === 'photo' && assets.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {assets.map((asset) => (
            <figure key={asset.assetId} className="overflow-hidden rounded-2xl border border-line bg-surface">
              {/* Provider-hosted URL. Not next/image: the host is not in the
                  image config allowlist and adding a wildcard remote pattern
                  would be a real security regression. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt="" className="aspect-square w-full object-cover" />
              <figcaption className="flex items-center justify-between px-4 py-3 text-xs text-content-secondary">
                <span>v{asset.version}</span>
                <span className="rounded-full bg-warning-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning">
                  pending review
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {kind === 'video' && outputUrl && (
        <div className="overflow-hidden rounded-2xl border border-line bg-black">
          <video src={outputUrl} controls className="w-full" />
        </div>
      )}

      {initial.requiresReview && (
        <p className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-xs leading-5 text-content-secondary">
          Generated media lands in review, not straight in your library — a human confirms the product still looks
          like itself. Clear it in{' '}
          <Link href="/dashboard/approvals" className="font-semibold text-ink underline">
            Approvals
          </Link>{' '}
          or on the product page.
        </p>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: JobState['state'] }) {
  if (state === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-3 py-1 text-xs font-semibold text-success">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Complete
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-subtle px-3 py-1 text-xs font-semibold text-danger">
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1 text-xs font-semibold text-content-secondary">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {state === 'queued' ? 'Queued' : 'Rendering'}
    </span>
  );
}
