'use client';

import { useState } from 'react';
import { Check, Copy as CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { FactualityNotice, GenerationMeta } from './FactualityNotice';
import type { CopyResponse } from './types';

/**
 * Renders copy variations as copy.
 *
 * The old studio printed `JSON.stringify(result, null, 2)` — the writer had to
 * read their own ad out of a JSON blob and hand-strip the quotes. Each variation
 * now has a copy-to-clipboard that yields exactly what would be published.
 */
export function CopyResult({ result }: { result: CopyResponse }) {
  return (
    <div className="space-y-4">
      {result.variations.map((variation, index) => (
        <Variation key={index} variation={variation} index={index} total={result.variations.length} />
      ))}
      <GenerationMeta generation={result.generation} creditsRemaining={result.creditsRemaining} />
    </div>
  );
}

function Variation({
  variation,
  index,
  total,
}: {
  variation: CopyResponse['variations'][number];
  index: number;
  total: number;
}) {
  const [copied, setCopied] = useState(false);

  // What gets copied is the publishable text only — never the rationale, and
  // never the factuality notes.
  const publishable = [variation.headline, variation.body, variation.cta, variation.hashtags.join(' ')]
    .filter((part) => part && part.trim().length > 0)
    .join('\n\n');

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(publishable);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is blocked in some browsers and every insecure
      // context. Say so instead of silently doing nothing.
      toast.error('Your browser blocked clipboard access — select the text and copy it manually.');
    }
  }

  return (
    <article className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        {total > 1 && (
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Version {index + 1}</p>
        )}
        <button
          type="button"
          onClick={() => void copyToClipboard()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-canvas-alt"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {variation.headline && (
        <h3 className="mt-2 font-display text-lg font-semibold leading-snug text-ink">{variation.headline}</h3>
      )}

      <div className="mt-3 space-y-3 text-sm leading-7 text-ink">
        {variation.body.split('\n').filter(Boolean).map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>

      {variation.cta && (
        <p className="mt-4 inline-block rounded-full bg-ink px-4 py-2 text-xs font-semibold text-canvas">
          {variation.cta}
        </p>
      )}

      {variation.hashtags.length > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
          {variation.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ')}
        </p>
      )}

      {variation.rationale && (
        <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-ink-soft">
          <span className="font-semibold text-ink">Why this works:</span> {variation.rationale}
        </p>
      )}

      <FactualityNotice factuality={variation.factuality} />
    </article>
  );
}
