'use client';

import Link from 'next/link';
import { AlertTriangle, Info } from 'lucide-react';
import type { Factuality } from './types';

/**
 * Surfaces what the factuality guard found on generated copy.
 *
 * The guard already persisted these findings to `content_factuality`; showing
 * them at the point of generation is what stops the writer from copying a
 * blocked claim out of the studio and pasting it somewhere the guard cannot
 * see.
 */
export function FactualityNotice({ factuality }: { factuality?: Factuality }) {
  if (!factuality || factuality.findings.length === 0) return null;

  const blocked = factuality.blocked;

  return (
    <div
      role={blocked ? 'alert' : 'note'}
      className={`mt-4 rounded-xl border px-4 py-3 ${
        blocked ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <p
        className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${
          blocked ? 'text-red-700' : 'text-amber-800'
        }`}
      >
        {blocked ? (
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {blocked ? 'Held for review' : 'Worth a second look'}
      </p>

      <ul className="mt-2 space-y-2">
        {factuality.findings.map((finding, i) => (
          <li key={i} className="text-xs leading-5 text-ink-soft">
            <span className="font-semibold text-ink">{finding.category.replace(/_/g, ' ')}:</span>{' '}
            <span className="font-medium">“{finding.excerpt}”</span> — {finding.explanation}
          </li>
        ))}
      </ul>

      {blocked && (
        <p className="mt-3 text-xs text-ink-soft">
          This copy cannot be published until someone clears the findings in{' '}
          <Link href="/dashboard/approvals" className="font-semibold text-ink underline">
            Approvals
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/** Provenance line. Shown because "which model wrote this" is an audit question. */
export function GenerationMeta({
  generation,
  creditsRemaining,
}: {
  generation?: { provider: string; model: string; attempts: number; viaFallback: boolean };
  creditsRemaining?: number | null;
}) {
  if (!generation) return null;
  return (
    <p className="mt-4 text-[11px] text-ink-faint">
      {generation.provider} · {generation.model}
      {generation.attempts > 1 && ` · ${generation.attempts} attempts`}
      {generation.viaFallback && ' · served by fallback provider'}
      {typeof creditsRemaining === 'number' && ` · ${creditsRemaining} credits left`}
    </p>
  );
}
