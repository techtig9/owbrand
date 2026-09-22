/**
 * Contrast checker for the OwBrand design tokens.
 *
 * The spec targets WCAG 2.2 AA, which is a numeric requirement, so it is
 * checked numerically. Every pair the product actually renders is listed here
 * and asserted — palettes chosen by eye fail exactly the pairs nobody thought
 * to look at (secondary text on a tinted surface, a border against the page,
 * a semantic badge in dark mode).
 *
 * Run: node scripts/check-contrast.mjs
 * Exits non-zero on any failure, so CI can gate on it.
 */

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ------------------------------------------------------------------ *
 * The palette
 * ------------------------------------------------------------------ */

const light = {
  // Surfaces: premium near-white page, white cards, a faintly cool raised step.
  bg: '#FAFAFB',
  surface: '#FFFFFF',
  surfaceRaised: '#F4F5F7',
  surfaceSunken: '#EFF0F3',
  // Text: charcoal primary, slate secondary, a lighter tertiary.
  text: '#1A1C21',
  textSecondary: '#4B5162',
  textTertiary: '#646D7B',
  // Borders: subtle cool gray. `borderStrong` is for controls that must be
  // discernible on their own (inputs), which needs 3:1, not 1.5:1.
  border: '#E4E6EB',
  borderStrong: '#828A9C',
  // Primary: deep indigo.
  primary: '#4338CA',
  primaryHover: '#3730A3',
  primaryText: '#FFFFFF',
  primarySubtle: '#EEF0FE',
  primaryOnSubtle: '#3730A3',
  // Semantic.
  success: '#15803D',
  successSubtle: '#EBF7EF',
  warning: '#A16207',
  warningSubtle: '#FDF6E3',
  danger: '#B91C1C',
  dangerSubtle: '#FDF0F0',
  info: '#0369A1',
  infoSubtle: '#EBF5FB',
  ai: '#6D28D9',
  aiSubtle: '#F3EEFE',
};

const dark = {
  // Dark is DESIGNED, not inverted: surfaces step up from a deep cool base,
  // and every accent is re-chosen for a dark ground rather than reused.
  bg: '#0E1016',
  surface: '#16181F',
  surfaceRaised: '#1E212A',
  surfaceSunken: '#0A0C11',
  text: '#F2F3F5',
  textSecondary: '#B0B6C3',
  textTertiary: '#8B92A1',
  border: '#2A2E39',
  borderStrong: '#6B7280',
  // A 4338CA indigo on a dark ground fails contrast badly, so the dark theme
  // uses lighter steps of the same hue.
  primary: '#8B8AF5',
  primaryHover: '#A5A4F8',
  primaryText: '#12131A',
  primarySubtle: '#1E1E3C',
  primaryOnSubtle: '#B4B3F9',
  success: '#4ADE80',
  successSubtle: '#10281A',
  warning: '#FBBF24',
  warningSubtle: '#2A2110',
  danger: '#F87171',
  dangerSubtle: '#2C1416',
  info: '#38BDF8',
  infoSubtle: '#0C2430',
  ai: '#C4B5FD',
  aiSubtle: '#241B3D',
};

/* ------------------------------------------------------------------ *
 * The pairs the product actually renders
 * ------------------------------------------------------------------ */

/** 4.5:1 for body text, 3:1 for large text and non-text UI. */
function pairsFor(t) {
  return [
    // Body text on every surface it can land on.
    ['text on bg', t.text, t.bg, 4.5],
    ['text on surface', t.text, t.surface, 4.5],
    ['text on surfaceRaised', t.text, t.surfaceRaised, 4.5],
    ['text on surfaceSunken', t.text, t.surfaceSunken, 4.5],
    ['secondary on bg', t.textSecondary, t.bg, 4.5],
    ['secondary on surface', t.textSecondary, t.surface, 4.5],
    ['secondary on surfaceRaised', t.textSecondary, t.surfaceRaised, 4.5],
    // Tertiary is used for hints and axis labels — still must clear AA, because
    // "decorative" text that carries information is not decorative.
    ['tertiary on bg', t.textTertiary, t.bg, 4.5],
    ['tertiary on surface', t.textTertiary, t.surface, 4.5],
    // These two were MISSING, and their absence is what let a real failure
    // ship: #6b7280 on the raised surface is 4.43:1, just under AA, and axe
    // found it on the landing page after the palette change. Every text token
    // is now checked against every surface it can land on.
    ['tertiary on surfaceRaised', t.textTertiary, t.surfaceRaised, 4.5],
    ['tertiary on surfaceSunken', t.textTertiary, t.surfaceSunken, 4.5],
    ['secondary on surfaceSunken', t.textSecondary, t.surfaceSunken, 4.5],
    ['text on surfaceOverlay', t.text, t.surfaceOverlay ?? t.surface, 4.5],

    // Controls and focus rings are non-text UI: 3:1.
    ['borderStrong on surface', t.borderStrong, t.surface, 3],
    ['borderStrong on bg', t.borderStrong, t.bg, 3],
    ['primary as focus ring on bg', t.primary, t.bg, 3],
    ['primary as focus ring on surface', t.primary, t.surface, 3],

    // Buttons.
    ['primaryText on primary', t.primaryText, t.primary, 4.5],
    ['primaryText on primaryHover', t.primaryText, t.primaryHover, 4.5],
    ['primary link on surface', t.primary, t.surface, 4.5],
    ['primaryOnSubtle on primarySubtle', t.primaryOnSubtle, t.primarySubtle, 4.5],

    // Semantic text on its own subtle background — the badge pattern.
    ['success on successSubtle', t.success, t.successSubtle, 4.5],
    ['warning on warningSubtle', t.warning, t.warningSubtle, 4.5],
    ['danger on dangerSubtle', t.danger, t.dangerSubtle, 4.5],
    ['info on infoSubtle', t.info, t.infoSubtle, 4.5],
    ['ai on aiSubtle', t.ai, t.aiSubtle, 4.5],

    // And on the plain surface, since badges are not the only usage.
    ['success on surface', t.success, t.surface, 4.5],
    ['warning on surface', t.warning, t.surface, 4.5],
    ['danger on surface', t.danger, t.surface, 4.5],
    ['info on surface', t.info, t.surface, 4.5],
    ['ai on surface', t.ai, t.surface, 4.5],

    // Semantic marks as non-text indicators (dots, bars, chart marks).
    ['success as mark on surface', t.success, t.surface, 3],
    ['danger as mark on surface', t.danger, t.surface, 3],
  ];
}

/**
 * Chart palettes, validated separately by the dataviz palette validator
 * (lightness band, chroma floor, CVD separation, normal-vision floor,
 * contrast). Recorded here so the whole colour system is auditable in one
 * place; re-run the validator after changing any of them.
 *
 *   light categorical: #4338CA,#A16207,#0891B2,#BE185D  → all 5 checks pass
 *   dark  categorical: #6F6FE0,#BF8214,#3597BD,#CF5990  → all 5 checks pass
 *
 * Capped at FOUR slots deliberately. A fifth hue that includes both green and
 * red cannot clear the protanopia/deuteranopia separation floor — a 5-slot set
 * failed at ΔE 5.0. Past four series the answer is small multiples or folding
 * the tail into "Other", never a generated hue.
 *
 * The semantic colours are NOT part of that set: they are reserved for state
 * and always ship with an icon or label, never colour alone.
 */
const chartCategorical = {
  light: ['#4338CA', '#A16207', '#0891B2', '#BE185D'],
  dark: ['#6F6FE0', '#BF8214', '#3597BD', '#CF5990'],
};

let failures = 0;
let warnings = 0;

for (const [themeName, tokens] of [
  ['light', light],
  ['dark', dark],
]) {
  console.log(`\n${themeName.toUpperCase()} THEME`);
  for (const [label, fg, bg, required] of pairsFor(tokens)) {
    const ratio = contrast(fg, bg);
    const pass = ratio >= required;
    if (!pass) failures += 1;
    console.log(
      `  ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(38)} ${ratio.toFixed(2)}:1  (needs ${required}:1)`
    );
  }
}

console.log('\nCHART CATEGORICAL vs SURFACE (3:1 for non-text marks)');
for (const [themeName, tokens] of [
  ['light', light],
  ['dark', dark],
]) {
  for (const hue of chartCategorical[themeName]) {
    const ratio = contrast(hue, tokens.surface);
    const pass = ratio >= 3;
    if (!pass) failures += 1;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${themeName} ${hue} on surface  ${ratio.toFixed(2)}:1`);
  }
}

/*
 * Surface separation. A raised card on the page background must be
 * distinguishable without relying on a border, or the layout collapses for
 * anyone who cannot see the hairline.
 */
console.log('\nSURFACE SEPARATION (informational)');
for (const [themeName, tokens] of [
  ['light', light],
  ['dark', dark],
]) {
  const ratio = contrast(tokens.surface, tokens.bg);
  const ok = ratio >= 1.03;
  if (!ok) warnings += 1;
  console.log(`  ${ok ? 'ok  ' : 'WARN'}  ${themeName} surface vs bg  ${ratio.toFixed(3)}:1`);
}

console.log(
  `\n${failures === 0 ? 'ALL CONTRAST CHECKS PASSED' : `${failures} CONTRAST FAILURE(S)`}` +
    (warnings > 0 ? ` · ${warnings} warning(s)` : '')
);

process.exit(failures === 0 ? 0 : 1);
