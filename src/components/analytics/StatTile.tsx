'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { DATA_HUE, CONTEXT_HUE, MARK, compactNumber } from './chart-tokens';

/**
 * Stat tile: label · value · delta · sparkline.
 *
 * The right form for a headline number — a one-bar bar chart would be worse.
 *
 * The delta is the part that has to be careful. `percent: null` means the
 * previous period had nothing to compare against, and the tile says "no prior
 * data" rather than showing +100% or 0%. Both of those turn an absence of
 * measurement into a performance claim.
 */

export interface StatTileProps {
  label: string;
  value: string;
  /** Null when the metric was never reported — renders as "not measured". */
  measured?: boolean;
  delta?: {
    percent: number | null;
    direction: 'up' | 'down' | 'flat' | 'new';
    previousLabel: string;
  } | null;
  /** Up to ~30 points. Drawn in the de-emphasis hue with the last point accented. */
  sparkline?: number[];
  /** Whether a rise is good. Engagement up is good; cost per click up is not. */
  higherIsBetter?: boolean;
}

export function StatTile({
  label,
  value,
  measured = true,
  delta,
  sparkline,
  higherIsBetter = true,
}: StatTileProps) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <p className="text-xs font-medium text-ink-faint">{label}</p>

      {measured ? (
        // Proportional figures, not tabular: at display size tabular-nums
        // makes a number like 121 look loose.
        <p className="mt-1 font-display text-2xl font-bold text-ink">{value}</p>
      ) : (
        <p className="mt-1 font-display text-2xl font-bold text-ink-faint" title="This platform did not report this metric">
          —
        </p>
      )}

      {measured && delta && <Delta delta={delta} higherIsBetter={higherIsBetter} />}

      {!measured && <p className="mt-1 text-[11px] leading-4 text-ink-faint">Not reported by the platform</p>}

      {measured && sparkline && sparkline.length > 1 && <Sparkline values={sparkline} />}
    </div>
  );
}

function Delta({
  delta,
  higherIsBetter,
}: {
  delta: NonNullable<StatTileProps['delta']>;
  higherIsBetter: boolean;
}) {
  if (delta.direction === 'new') {
    return (
      <p className="mt-1.5 text-[11px] leading-4 text-ink-faint">
        No {delta.previousLabel} data to compare against
      </p>
    );
  }

  if (delta.percent === null || delta.direction === 'flat') {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint">
        <Minus className="h-3 w-3" aria-hidden="true" />
        Flat vs {delta.previousLabel}
      </p>
    );
  }

  const rising = delta.direction === 'up';
  const good = rising === higherIsBetter;

  // Direction is carried by the arrow as well as the colour, so it never
  // depends on colour alone.
  const Icon = rising ? ArrowUp : ArrowDown;

  return (
    <p
      className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold ${
        good ? 'text-mint-600' : 'text-coral-600'
      }`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="tabular-nums">
        {rising ? '+' : ''}
        {(delta.percent * 100).toFixed(1)}%
      </span>
      <span className="font-normal text-ink-faint">vs {delta.previousLabel}</span>
    </p>
  );
}

/** 12–30 point sparkline. The current point is accented; the rest recede. */
function Sparkline({ values }: { values: number[] }) {
  const width = 120;
  const height = 28;
  const max = Math.max(1, ...values);

  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => height - (value / max) * (height - 4) - 2;

  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const lastIndex = values.length - 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-7 w-full" aria-hidden="true">
      <polyline
        points={line}
        fill="none"
        stroke={CONTEXT_HUE}
        strokeWidth={MARK.lineWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(lastIndex)} cy={y(values[lastIndex])} r={3} fill={DATA_HUE} />
    </svg>
  );
}

/**
 * Horizontal magnitude bars.
 *
 * Every bar carries the SAME hue: length is the encoding. Shading bars by rank
 * would mean colour followed position rather than the entity, so a filter that
 * dropped one platform would repaint the survivors.
 */
export function MagnitudeBars({
  rows,
  valueLabel,
}: {
  rows: Array<{ label: string; value: number; secondary?: string }>;
  valueLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-canvas-alt px-4 py-8 text-center text-sm text-ink-faint">
        Nothing measured in this range.
      </p>
    );
  }

  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <ul className="space-y-3" aria-label={`${valueLabel} by platform`}>
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-ink">{row.label}</span>
            <span className="text-sm tabular-nums text-ink-soft">
              {compactNumber(row.value)}
              {row.secondary && <span className="ml-2 text-xs text-ink-faint">{row.secondary}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-canvas-alt">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                backgroundColor: DATA_HUE,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
