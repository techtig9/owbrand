import type { BrandBrain } from '@/lib/brand/schema';

/**
 * Brand-kit file generation.
 *
 * What a customer actually wants when they say "send me the brand kit" is a
 * folder they can hand to a designer, a developer or an agency without a
 * meeting. So the archive is organised around who opens it, not around how
 * our database is shaped:
 *
 *   - a **developer** gets tokens in the three formats they will actually
 *     paste into a project (CSS custom properties, a Tailwind fragment, SCSS);
 *   - a **designer** gets the palette as swatches and a plain list of hexes;
 *   - a **writer** gets the voice rules as a readable document, which is the
 *     part usually lost entirely because it lives in a slide deck nobody can
 *     find.
 *
 * Every file is generated from the Brand Brain, so the kit cannot disagree
 * with what the product generates from. That is the whole argument for
 * exporting from here rather than maintaining a separate kit document.
 */

export interface KitFile {
  name: string;
  content: string;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'color'
  );
}

/** Relative luminance, for choosing readable text over a swatch. */
function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255);
  const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function cssTokens(brain: BrandBrain): string {
  const colors = brain.visualIdentity?.colors ?? [];
  const fonts = brain.visualIdentity?.fonts;

  const lines = [
    '/*',
    ` * ${brain.name} — design tokens`,
    ' *',
    ' * Generated from the Brand Brain. Regenerating the kit overwrites this,',
    ' * so edit the brand rather than the file — otherwise the next export',
    ' * silently reverts your change.',
    ' */',
    ':root {',
  ];

  colors.forEach((color, index) => {
    const name = color.role ? slug(color.role) : `brand-${index + 1}`;
    lines.push(`  --color-${name}: ${color.hex};`);
  });

  if (fonts?.heading) lines.push(`  --font-heading: ${JSON.stringify(fonts.heading)};`);
  if (fonts?.body) lines.push(`  --font-body: ${JSON.stringify(fonts.body)};`);

  lines.push('}');
  return lines.join('\n') + '\n';
}

export function tailwindFragment(brain: BrandBrain): string {
  const colors = brain.visualIdentity?.colors ?? [];
  const fonts = brain.visualIdentity?.fonts;

  const colorEntries = colors
    .map((color, index) => `        '${color.role ? slug(color.role) : `brand-${index + 1}`}': '${color.hex}',`)
    .join('\n');

  const fontEntries = [
    fonts?.heading ? `        heading: [${JSON.stringify(fonts.heading)}, 'sans-serif'],` : '',
    fonts?.body ? `        body: [${JSON.stringify(fonts.body)}, 'sans-serif'],` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `// ${brain.name} — merge into tailwind.config.js
//
// Under \`theme.extend\`, not \`theme\`: replacing \`theme.colors\` wholesale
// removes Tailwind's own palette, and the first thing that breaks is every
// \`text-gray-500\` already in the project.
module.exports = {
  theme: {
    extend: {
      colors: {
${colorEntries || '        // No palette defined in the Brand Brain yet.'}
      },
      fontFamily: {
${fontEntries || '        // No fonts defined in the Brand Brain yet.'}
      },
    },
  },
};
`;
}

export function scssVariables(brain: BrandBrain): string {
  const colors = brain.visualIdentity?.colors ?? [];
  const header = `// ${brain.name} — SCSS variables\n// Generated from the Brand Brain.\n\n`;
  const body = colors
    .map((color, index) => `$${color.role ? slug(color.role) : `brand-${index + 1}`}: ${color.hex};`)
    .join('\n');
  return header + (body || '// No palette defined yet.') + '\n';
}

/**
 * A single self-contained HTML page showing the palette.
 *
 * Self-contained because a swatch sheet that needs a build step is a swatch
 * sheet nobody opens. Double-clicking the file has to work from a USB stick,
 * from an email attachment, from a folder on a designer's desktop.
 */
export function paletteHtml(brain: BrandBrain): string {
  const colors = brain.visualIdentity?.colors ?? [];

  const swatches = colors
    .map((color) => {
      // Text colour chosen by measured luminance rather than guessed, so a
      // pale brand colour does not produce white-on-white.
      const text = luminance(color.hex) > 0.5 ? '#111111' : '#ffffff';
      return `    <figure class="swatch" style="background:${color.hex};color:${text}">
      <figcaption>
        <strong>${color.role ?? 'Brand colour'}</strong>
        <code>${color.hex}</code>
      </figcaption>
    </figure>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brain.name} — palette</title>
<style>
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 40px; background: #fafafa; color: #111; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  p.sub { color: #666; margin: 0 0 32px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
  .swatch { margin: 0; aspect-ratio: 4 / 3; border-radius: 12px; display: flex; align-items: flex-end; padding: 16px; }
  figcaption strong { display: block; font-size: 14px; }
  figcaption code { font-size: 12px; opacity: 0.85; }
</style>
</head>
<body>
  <h1>${brain.name}</h1>
  <p class="sub">Brand palette. Generated from the Brand Brain.</p>
  <div class="grid">
${swatches || '    <p>No palette defined yet.</p>'}
  </div>
</body>
</html>
`;
}

/**
 * The voice guide.
 *
 * The part of a brand kit that is usually lost. Colours survive because they
 * end up in a config file; the reason a brand never says "revolutionary" lives
 * in someone's head, and leaves when they do.
 */
export function voiceGuide(brain: BrandBrain): string {
  const voice = brain.voice;
  const guidelines = brain.guidelines;
  const lines = [`# ${brain.name} — voice and writing`, ''];

  if (brain.tagline) lines.push(`> ${brain.tagline}`, '');
  if (voice?.voice) lines.push('## Voice', '', voice.voice, '');
  if (voice?.tone?.length) lines.push('## Tone', '', voice.tone.map((t) => `- ${t}`).join('\n'), '');

  if (voice?.preferredWords?.length) {
    lines.push('## Words to use', '', voice.preferredWords.map((w) => `- ${w}`).join('\n'), '');
  }

  if (voice?.avoidedWords?.length) {
    lines.push(
      '## Words never to use',
      '',
      // Stated as enforced rather than advisory, because it is: the
      // consistency check treats each of these as a blocker.
      'These are checked automatically. Copy containing any of them is flagged as a blocker.',
      '',
      voice.avoidedWords.map((w) => `- ${w}`).join('\n'),
      ''
    );
  }

  if (voice?.writingRules?.length) {
    lines.push('## Rules', '', voice.writingRules.map((r) => `- ${r}`).join('\n'), '');
  }

  if (voice?.exampleCopy) {
    lines.push('## An example in the right voice', '', `> ${voice.exampleCopy}`, '');
  }

  if (guidelines?.doRules?.length) {
    lines.push('## Always', '', guidelines.doRules.map((r) => `- ${r}`).join('\n'), '');
  }

  if (guidelines?.dontRules?.length) {
    lines.push('## Never', '', guidelines.dontRules.map((r) => `- ${r}`).join('\n'), '');
  }

  /*
   * Gaps are stated rather than omitted. A voice guide that simply lacks a
   * section reads as "this brand has no rules about that"; one that says the
   * section is empty tells a writer there is a decision still to make, and
   * tells the brand owner what to go and fill in.
   */
  const missing: string[] = [];
  if (!voice?.voice) missing.push('a voice description');
  if (!voice?.tone?.length) missing.push('tone words');
  if (!voice?.avoidedWords?.length) missing.push('an avoid list');
  if (!voice?.writingRules?.length) missing.push('writing rules');
  if (!voice?.exampleCopy) missing.push('an example of the right voice');

  if (missing.length > 0) {
    // Written as a sentence rather than assembled from fragments: a single
    // gap followed by "each of these" reads as a bug in a document a customer
    // forwards to their designer.
    const list =
      missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} or ${missing[missing.length - 1]}`;

    lines.push(
      '## Not defined yet',
      '',
      `This brand has not defined ${list}.`,
      '',
      missing.length === 1
        ? 'This is one of the things the automatic consistency check measures against, so'
        : 'These are what the automatic consistency check measures against, so an',
      missing.length === 1
        ? 'leaving it undefined means it cannot be enforced.'
        : 'undefined rule is one that cannot be enforced.',
      ''
    );
  }

  return lines.join('\n');
}

export function kitReadme(brain: BrandBrain, attribution: string, hasLogo = false): string {
  return `# ${brain.name} — brand kit

${brain.tagline ? `> ${brain.tagline}\n` : ''}
Generated from this brand's Brand Brain, so everything here matches what the
product generates from. Regenerate the kit after changing the brand rather
than editing these files — an edit here is overwritten by the next export and
does not change anything the product does.

## What is in here

| File | For |
| --- | --- |
| \`tokens/tokens.css\` | CSS custom properties. Drop into any stylesheet. |
| \`tokens/tailwind.config.js\` | A Tailwind fragment. Merge under \`theme.extend\`. |
| \`tokens/_variables.scss\` | SCSS variables. |
| \`palette.html\` | Open in a browser. Self-contained, no build step. |
| \`VOICE.md\` | Voice, tone, and the words this brand does and does not use. |
| \`brand-brain.json\` | The complete structured brand, for tooling. |
${hasLogo ? '| `logo/` | The logo file as stored on the brand. |\n' : ''}
## The part people lose

\`VOICE.md\` is the one that matters six months from now. Colours survive
because they end up in a config file. The reason this brand never says a
particular word lives in someone's head, and leaves when they do.
${attribution}`;
}
