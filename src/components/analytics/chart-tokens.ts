/**
 * Chart parameters for OwBrand.
 *
 * Deliberately SEQUENTIAL, single-hue — not categorical. The brand's accent
 * set (blush #E29B95, mint #8FBB9C, lavender #C3AFE3) was run through the
 * palette validator and fails as a categorical palette on three checks: two
 * pairs sit below the normal-vision separation floor (ΔE 11.1, needs ≥15), the
 * pastels fall below the chroma floor so they read as grey, and all three fall
 * under 3:1 against a white surface. They are a warm editorial brand palette,
 * which is a different job from telling data series apart.
 *
 * So every chart here encodes magnitude by LENGTH or POSITION in one hue, and
 * identity by label — never by asking a reader to distinguish four pastels.
 * Coral-600 clears 4.27:1 on white and 4.00:1 on the cream surface.
 *
 * The ramp is monotonic in relative luminance
 * (0.84 → 0.64 → 0.37 → 0.28 → 0.20 → 0.12), so it is a valid sequential
 * scale if a heatmap is ever added.
 */

/** The single data hue. 4.27:1 on white — over the 3:1 mark floor. */
export const DATA_HUE = '#C65A36';
/** For a second, subordinate series (previous period). Grey, not a hue. */
export const CONTEXT_HUE = '#9A9188';
/** Area wash. The skill's spec is the series hue at ~10%. */
export const AREA_OPACITY = 0.1;

/** Monotonic sequential ramp, light → dark. */
export const SEQUENTIAL_RAMP = ['#FAE9E2', '#F3C9B8', '#EA8B68', '#E07049', '#C65A36', '#A2472A'] as const;

/** Recessive chrome. One step off the surface, hairline, solid. */
export const GRID_COLOR = '#E7E0D6';
export const AXIS_TEXT = '#9A9188';
export const SURFACE = '#FFFFFF';

/** Mark specs, from the dataviz reference. */
export const MARK = {
  lineWidth: 2,
  markerRadius: 4,
  /** Surface-coloured ring so markers stay legible over the line. */
  markerRing: 2,
  /** Bars are capped rather than filling their band — the leftover is air. */
  maxBarThickness: 24,
  barRadius: 4,
  /** Gap in the surface colour between touching marks. */
  surfaceGap: 2,
} as const;

/** Compact value formatting for stat tiles: 1,284 / 12.9K / 4.2M. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toLocaleString();
}

/**
 * Formats a rate, or an em dash when it was never measured.
 *
 * The whole analytics layer depends on null and 0 staying distinct: a platform
 * that does not report clicks must not show "0.00% CTR", which is a
 * measurement claim nobody made.
 */
export function formatRate(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatMultiple(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}×`;
}

/** Axis ticks at clean round numbers. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];

  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(value);
  return ticks;
}
