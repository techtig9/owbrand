'use client';

import { useMemo, useRef, useState } from 'react';
import {
  DATA_HUE,
  AREA_OPACITY,
  GRID_COLOR,
  AXIS_TEXT,
  SURFACE,
  MARK,
  compactNumber,
  niceTicks,
} from './chart-tokens';

/**
 * Single-series trend, as an area + line with a crosshair tooltip.
 *
 * One series by design, chosen from a metric picker above it. The alternative —
 * plotting impressions and engagement rate together — would need two y-scales,
 * which is the single worst chart mistake: the crossing point where one line
 * appears to overtake the other is an artefact of the scales, not the data.
 *
 * Days with no ingested row are drawn as a GAP, not interpolated. A line drawn
 * straight through a missing week looks like measured flat performance, which
 * is a fabricated measurement.
 */

export interface TrendPoint {
  date: string;
  value: number;
}

const WIDTH = 760;
const HEIGHT = 240;
const PADDING = { top: 16, right: 20, bottom: 28, left: 52 };

export function TrendChart({
  points,
  missingDates,
  label,
  formatValue = compactNumber,
}: {
  points: TrendPoint[];
  missingDates: string[];
  label: string;
  formatValue?: (value: number) => string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const missing = useMemo(() => new Set(missingDates), [missingDates]);

  const plot = useMemo(() => {
    const innerWidth = WIDTH - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const max = Math.max(1, ...points.map((point) => point.value));
    const ticks = niceTicks(max);
    const scaleMax = Math.max(max, ticks[ticks.length - 1] ?? max);

    const x = (index: number) =>
      points.length <= 1
        ? PADDING.left + innerWidth / 2
        : PADDING.left + (index / (points.length - 1)) * innerWidth;

    const y = (value: number) => PADDING.top + innerHeight - (value / scaleMax) * innerHeight;

    // Split into runs of measured days so a gap stays a gap.
    const runs: Array<Array<{ index: number; point: TrendPoint }>> = [];
    let run: Array<{ index: number; point: TrendPoint }> = [];

    points.forEach((point, index) => {
      if (missing.has(point.date)) {
        if (run.length > 0) runs.push(run);
        run = [];
        return;
      }
      run.push({ index, point });
    });
    if (run.length > 0) runs.push(run);

    return { innerWidth, innerHeight, ticks, scaleMax, x, y, runs };
  }, [points, missing]);

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;

    const rect = svg.getBoundingClientRect();
    // The SVG scales responsively, so client pixels must be mapped back into
    // the viewBox before they mean anything.
    const scale = WIDTH / rect.width;
    const localX = (event.clientX - rect.left) * scale;

    const ratio = (localX - PADDING.left) / plot.innerWidth;
    const index = Math.round(ratio * (points.length - 1));
    setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  const hovered = hoverIndex === null ? null : points[hoverIndex];
  const hoveredMissing = hovered ? missing.has(hovered.date) : false;

  if (points.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-surface-raised px-4 py-10 text-center text-sm text-content-tertiary">
        No data in this range.
      </p>
    );
  }

  return (
    <figure className="m-0">
      <div className="relative overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[520px]"
          role="img"
          aria-label={`${label} over time`}
          onPointerMove={handleMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {/* Gridlines: hairline, solid, one step off the surface. */}
          {plot.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={plot.y(tick)}
                y2={plot.y(tick)}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
                y={plot.y(tick) + 4}
                textAnchor="end"
                fontSize={11}
                fill={AXIS_TEXT}
                className="tabular-nums"
              >
                {compactNumber(tick)}
              </text>
            </g>
          ))}

          {plot.runs.map((runPoints, runIndex) => {
            const line = runPoints
              .map(({ index, point }) => `${plot.x(index)},${plot.y(point.value)}`)
              .join(' ');

            const areaPath = [
              `M ${plot.x(runPoints[0].index)} ${plot.y(0)}`,
              ...runPoints.map(({ index, point }) => `L ${plot.x(index)} ${plot.y(point.value)}`),
              `L ${plot.x(runPoints[runPoints.length - 1].index)} ${plot.y(0)}`,
              'Z',
            ].join(' ');

            return (
              <g key={runIndex}>
                <path d={areaPath} fill={DATA_HUE} fillOpacity={AREA_OPACITY} />
                {runPoints.length > 1 ? (
                  <polyline
                    points={line}
                    fill="none"
                    stroke={DATA_HUE}
                    strokeWidth={MARK.lineWidth}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : (
                  <circle
                    cx={plot.x(runPoints[0].index)}
                    cy={plot.y(runPoints[0].point.value)}
                    r={MARK.markerRadius}
                    fill={DATA_HUE}
                    stroke={SURFACE}
                    strokeWidth={MARK.markerRing}
                  />
                )}
              </g>
            );
          })}

          {/* Crosshair. */}
          {hoverIndex !== null && (
            <g>
              <line
                x1={plot.x(hoverIndex)}
                x2={plot.x(hoverIndex)}
                y1={PADDING.top}
                y2={HEIGHT - PADDING.bottom}
                stroke={AXIS_TEXT}
                strokeWidth={1}
              />
              {!hoveredMissing && hovered && (
                <circle
                  cx={plot.x(hoverIndex)}
                  cy={plot.y(hovered.value)}
                  r={MARK.markerRadius + 1}
                  fill={DATA_HUE}
                  stroke={SURFACE}
                  strokeWidth={MARK.markerRing}
                />
              )}
            </g>
          )}

          {/* First and last date only — a tick per day is unreadable. */}
          <text x={PADDING.left} y={HEIGHT - 8} fontSize={11} fill={AXIS_TEXT}>
            {points[0].date}
          </text>
          <text x={WIDTH - PADDING.right} y={HEIGHT - 8} textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
            {points[points.length - 1].date}
          </text>
        </svg>

        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute left-0 top-0 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-soft"
            style={{
              transform: `translateX(${(plot.x(hoverIndex!) / WIDTH) * 100}%)`,
              marginLeft: 8,
            }}
          >
            <p className="font-semibold text-ink">{hovered.date}</p>
            <p className="mt-0.5 text-content-secondary">
              {hoveredMissing ? (
                // The honest tooltip for a gap.
                <span>Not measured</span>
              ) : (
                <>
                  <span className="tabular-nums font-semibold text-ink">{formatValue(hovered.value)}</span> {label}
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {missingDates.length > 0 && (
        <figcaption className="mt-3 text-xs text-content-tertiary">
          {missingDates.length} day{missingDates.length === 1 ? '' : 's'} in this range have no ingested data and
          are shown as gaps rather than zeros.
        </figcaption>
      )}
    </figure>
  );
}
