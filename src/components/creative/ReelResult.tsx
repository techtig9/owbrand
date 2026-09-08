'use client';

import { Clock, Film, Music, Type } from 'lucide-react';
import { FactualityNotice } from './FactualityNotice';
import type { ReelResponse } from './types';

/**
 * Renders a reel script as a shot list.
 *
 * `renderState` is displayed rather than hidden. The route returns
 * `not_rendered` because nothing has rendered a video — telling the user they
 * have a shot plan is honest; showing a play button would not be.
 */
export function ReelResult({ result }: { result: ReelResponse }) {
  const { script } = result;
  const plannedDuration = script.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-content-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5" aria-hidden="true" /> {script.aspectRatio}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {script.durationSeconds}s target
          </span>
          <span>{script.scenes.length} scenes</span>
          {/* A shot list whose scene durations do not add up to the target is a
              real problem for the editor, so surface the arithmetic. */}
          {Math.abs(plannedDuration - script.durationSeconds) > 2 && (
            <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-warning">
              scenes total {plannedDuration.toFixed(1)}s
            </span>
          )}
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-content-tertiary">Hook</p>
        <p className="mt-1 font-display text-lg font-semibold leading-snug text-ink">{script.hook}</p>

        <p className="mt-4 text-sm leading-6 text-content-secondary">{script.concept}</p>

        {script.musicDirection && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-xl bg-surface-raised px-3 py-2 text-xs text-content-secondary">
            <Music className="h-3.5 w-3.5" aria-hidden="true" /> {script.musicDirection}
          </p>
        )}
      </div>

      <ol className="space-y-3">
        {[...script.scenes]
          .sort((a, b) => a.order - b.order)
          .map((scene) => (
            <li key={scene.order} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-xs font-bold text-canvas tabular-nums">
                  {scene.order}
                </span>
                <span className="text-xs text-content-tertiary tabular-nums">{scene.durationSeconds}s</span>
                <span className="rounded-full bg-surface-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-content-secondary">
                  {scene.transition}
                </span>
                {scene.sourceAssetIndex !== null && (
                  <span className="rounded-full bg-success-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-success">
                    asset #{scene.sourceAssetIndex + 1}
                  </span>
                )}
              </div>

              <p className="mt-3 text-sm leading-6 text-ink">{scene.visual}</p>

              {scene.onScreenText && (
                <p className="mt-3 inline-flex items-start gap-2 rounded-xl bg-surface-raised px-3 py-2 text-xs font-semibold text-ink">
                  <Type className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {scene.onScreenText}
                </p>
              )}

              {scene.voiceover && (
                <p className="mt-3 border-l-2 border-line pl-3 text-sm italic leading-6 text-content-secondary">
                  “{scene.voiceover}”
                </p>
              )}
            </li>
          ))}
      </ol>

      {(script.caption || script.cta || script.hashtags.length > 0) && (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">Post copy</p>
          {script.caption && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{script.caption}</p>}
          {script.cta && (
            <p className="mt-3 inline-block rounded-full bg-ink px-4 py-2 text-xs font-semibold text-canvas">
              {script.cta}
            </p>
          )}
          {script.hashtags.length > 0 && (
            <p className="mt-3 text-xs text-content-tertiary">
              {script.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ')}
            </p>
          )}
        </div>
      )}

      <FactualityNotice factuality={result.factuality} />

      <p className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-xs leading-5 text-content-secondary">
        <span className="font-semibold text-ink">Not rendered.</span>{' '}
        {result.note ?? 'This is the shot plan. Automated video rendering is delivered in Phase 3.'}
      </p>
    </div>
  );
}
