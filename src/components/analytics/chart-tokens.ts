/**
 * Chart parameters for OwBrand.
 *
 * PHASE 5: these now read the CSS custom properties from
 * src/styles/tokens.css, so charts follow the theme. Previously they were
 * hard-coded coral hex values, which meant the charts would have stayed warm
 * orange on a deep-indigo dark surface — the one place a hard-coded colour is
 * most obviously wrong.
 *
 * The palette itself is validated: the categorical slots clear the lightness
 * band, chroma floor, CVD separation and 3:1 contrast checks in BOTH themes,
 * and the sequential ramp is monotonic in lightness. `npm run check:contrast`
 * asserts the chart marks against their surfaces.
 *
 * Charts still encode magnitude by LENGTH and POSITION in one hue by default.
 * The four categorical slots exist for genuine multi-series work; past four
 * series the answer is small multiples, never a generated fifth hue.
 */

/**
 * Reads a token at call time.
 *
 * SVG `fill` and `stroke` accept `var(--token)` directly, so most marks use
 * the string form and follow a theme change with no JavaScript at all. This
 * helper exists only for the few places that need a resolved value (a canvas
 * context, an inline gradient stop), and it falls back to the light value when
 * there is no document — during SSR, or in a test.
 */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The single data hue, as a `var()` reference.
 *
 * Passing this straight to an SVG attribute is what makes the charts
 * theme-aware for free: the browser re-resolves the variable when the theme
 * attribute changes, with no re-render.
 */
export const DATA_HUE = 'var(--chart-1)';
/** A subordinate series (previous period, sparkline context). Grey, not a hue. */
export const CONTEXT_HUE = 'var(--chart-context)';
/** Area wash. The dataviz spec is the series hue at ~10%. */
export const AREA_OPACITY = 0.1;

/** Four categorical slots, in fixed order. Never cycled, never extended. */
export const CATEGORICAL = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
] as const;

/** Monotonic sequential ramp, light → dark. */
export const SEQUENTIAL_RAMP = [
  'var(--chart-seq-1)',
  'var(--chart-seq-2)',
  'var(--chart-seq-3)',
  'var(--chart-seq-4)',
  'var(--chart-seq-5)',
  'var(--chart-seq-6)',
] as const;

/** Recessive chrome. One step off the surface, hairline, solid. */
export const GRID_COLOR = 'var(--chart-grid)';
export const AXIS_TEXT = 'var(--chart-axis-text)';
/** The surface behind the marks — used for the 2px separating ring. */
export const SURFACE = 'var(--color-surface)';

/** Resolved values, for the rare caller that cannot use a var() string. */
export const resolved = {
  dataHue: () => token('--chart-1', '#4338CA'),
  surface: () => token('--color-surface', '#FFFFFF'),
};

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
