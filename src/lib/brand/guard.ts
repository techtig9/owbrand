/**
 * The factuality guard.
 *
 * Master command §6 is unambiguous: OwBrand must never invent product
 * specifications, prices, reviews, certifications, guarantees, medical claims,
 * legal claims, performance claims or testimonials. Before Phase 2 that rule
 * lived only as a sentence inside a prompt string — which is a request, not a
 * control.
 *
 * This module makes it two controls:
 *
 *   1. PREVENTION — `buildFactualityInstructions` compiles the brand's approved
 *      facts and prohibited claims into an explicit contract placed in the
 *      system prompt, listing what may be asserted and what may not.
 *   2. DETECTION — `screenGeneratedCopy` re-reads the output and flags text
 *      that asserts something in a forbidden category or a number that appears
 *      nowhere in the approved facts.
 *
 * Detection is a safety net, not a proof. It uses lexical patterns, so it will
 * miss a cleverly-worded violation and can flag an innocent phrase. That is why
 * findings are surfaced for human approval rather than silently deleted: the
 * approval workflow is the real control, and this makes it cheap to operate.
 */
import { DEFAULT_PROHIBITED_CLAIMS, type BrandBrain } from '@/lib/brand/schema';

export interface ApprovedFacts {
  /** Free-form facts approved for a product or brand. */
  facts: string[];
  /** Numeric values that may legitimately appear (price, size, count). */
  numbers: string[];
}

/* ------------------------------------------------------------------ *
 * 1. Prevention
 * ------------------------------------------------------------------ */

/**
 * Compiles the non-negotiable part of the system prompt.
 *
 * Placed in `system` rather than the user turn for two reasons: it carries
 * operator authority, and it is stable per brand so it sits inside the cached
 * prefix instead of being re-billed on every generation.
 */
export function buildFactualityInstructions(options: {
  brandBrain?: Pick<BrandBrain, 'name' | 'guidelines' | 'voice'> | null;
  approvedFacts?: ApprovedFacts;
  productName?: string;
}): string {
  const { brandBrain, approvedFacts, productName } = options;

  const approvedClaims = brandBrain?.guidelines?.approvedClaims ?? [];
  const brandProhibited = brandBrain?.guidelines?.prohibitedClaims ?? [];
  const prohibited = Array.from(new Set([...DEFAULT_PROHIBITED_CLAIMS, ...brandProhibited]));

  const sections: string[] = [];

  sections.push(
    [
      'FACTUAL ACCURACY — NON-NEGOTIABLE',
      '',
      'You may only state facts that appear in the APPROVED FACTS below. If a fact',
      'is not listed there, you must not assert it — not as a claim, not as an',
      'aside, and not implied through phrasing. When you need a fact you do not',
      'have, write copy that does not depend on it.',
      '',
      'Specifically, never invent: specifications, dimensions, materials, prices,',
      'ingredients, certifications, awards, test results, statistics, review',
      'counts, ratings, customer quotes, or delivery and warranty terms.',
    ].join('\n')
  );

  if (approvedFacts && (approvedFacts.facts.length > 0 || approvedFacts.numbers.length > 0)) {
    const lines = ['', `APPROVED FACTS${productName ? ` for ${productName}` : ''}:`];
    for (const fact of approvedFacts.facts.slice(0, 60)) lines.push(`- ${fact}`);
    if (approvedFacts.numbers.length > 0) {
      lines.push(`- The only figures you may quote: ${approvedFacts.numbers.slice(0, 40).join(', ')}`);
    }
    sections.push(lines.join('\n'));
  } else {
    sections.push(
      [
        '',
        'APPROVED FACTS: none have been recorded.',
        '',
        'Because there are no approved facts, you must write copy that makes no',
        'factual product assertions at all. Focus on brand voice, the customer’s',
        'situation, and the feeling — never on what the product is or does',
        'specifically. Do not fill the gap with plausible-sounding detail.',
      ].join('\n')
    );
  }

  if (approvedClaims.length > 0) {
    sections.push(
      ['', 'APPROVED CLAIMS (these specific claims are cleared for use):', ...approvedClaims.map((c) => `- ${c}`)].join(
        '\n'
      )
    );
  }

  sections.push(['', 'PROHIBITED — never write these, even if asked:', ...prohibited.map((c) => `- ${c}`)].join('\n'));

  if (brandBrain?.guidelines?.dontRules?.length) {
    sections.push(
      ['', `BRAND RULES — ${brandBrain.name} never:`, ...brandBrain.guidelines.dontRules.map((r) => `- ${r}`)].join(
        '\n'
      )
    );
  }

  if (brandBrain?.voice?.avoidedWords?.length) {
    sections.push(['', `NEVER use these words: ${brandBrain.voice.avoidedWords.join(', ')}`].join('\n'));
  }

  return sections.join('\n');
}

/**
 * Renders the Brand Brain as prompt context.
 *
 * `/api/ai/generate-content` previously sent only name, description, colours
 * and fonts — so positioning, tone, audience and rules, the entire point of the
 * Brand Brain, never reached the model. This is the fix.
 */
export function buildBrandContext(brain: BrandBrain): string {
  const parts: string[] = [`BRAND: ${brain.name}`];

  if (brain.tagline) parts.push(`Tagline: ${brain.tagline}`);
  if (brain.positioning?.usp) parts.push(`Unique selling proposition: ${brain.positioning.usp}`);
  if (brain.positioning?.marketPosition) parts.push(`Market position: ${brain.positioning.marketPosition}`);

  if (brain.positioning?.differentiators?.length) {
    parts.push(`Differentiators: ${brain.positioning.differentiators.join('; ')}`);
  }

  if (brain.audience?.summary) parts.push(`Audience: ${brain.audience.summary}`);
  if (brain.audience?.personas?.length) {
    const personas = brain.audience.personas
      .slice(0, 3)
      .map((p) => `${p.name}${p.description ? ` — ${p.description}` : ''}`)
      .join(' | ');
    parts.push(`Personas: ${personas}`);
  }
  if (brain.audience?.painPoints?.length) {
    parts.push(`Customer pain points: ${brain.audience.painPoints.slice(0, 6).join('; ')}`);
  }

  if (brain.voice?.voice) parts.push(`Voice: ${brain.voice.voice}`);
  if (brain.voice?.tone?.length) parts.push(`Tone: ${brain.voice.tone.join(', ')}`);
  if (brain.voice?.preferredWords?.length) {
    parts.push(`Prefer these words: ${brain.voice.preferredWords.join(', ')}`);
  }
  if (brain.voice?.writingRules?.length) {
    parts.push(`Writing rules: ${brain.voice.writingRules.join('; ')}`);
  }
  if (brain.voice?.exampleCopy) parts.push(`Example of the right voice: "${brain.voice.exampleCopy}"`);

  if (brain.contentStrategy?.pillars?.length) {
    parts.push(`Content pillars: ${brain.contentStrategy.pillars.map((p) => p.name).join(', ')}`);
  }

  if (brain.visualIdentity?.direction) parts.push(`Visual direction: ${brain.visualIdentity.direction}`);
  if (brain.visualIdentity?.colors?.length) {
    parts.push(
      `Brand colours: ${brain.visualIdentity.colors.map((c) => `${c.hex}${c.role ? ` (${c.role})` : ''}`).join(', ')}`
    );
  }

  if (brain.guidelines?.doRules?.length) {
    parts.push(`Always: ${brain.guidelines.doRules.slice(0, 8).join('; ')}`);
  }

  return parts.join('\n');
}

/* ------------------------------------------------------------------ *
 * 2. Detection
 * ------------------------------------------------------------------ */

export type FactualitySeverity = 'block' | 'review';

export interface FactualityFinding {
  severity: FactualitySeverity;
  category: string;
  /** The specific text that triggered the finding. */
  excerpt: string;
  explanation: string;
}

/** Categories that are always forbidden, with the lexical signals for each. */
const FORBIDDEN_PATTERNS: Array<{
  category: string;
  severity: FactualitySeverity;
  pattern: RegExp;
  explanation: string;
}> = [
  {
    category: 'medical_claim',
    severity: 'block',
    pattern:
      /\b(cures?|treats?|heals?|prevents?\s+(?:disease|illness|cancer)|clinically\s+proven|medically\s+proven|FDA[-\s]approved|dermatologist[-\s]tested|therapeutic)\b/gi,
    explanation: 'Asserts a medical or therapeutic effect.',
  },
  {
    category: 'guarantee',
    severity: 'block',
    pattern:
      /\b(guaranteed?\s+(?:results?|to\s+\w+)|money[-\s]back\s+guarantee|risk[-\s]free|100%\s+(?:effective|guaranteed|satisfaction))\b/gi,
    explanation: 'Promises a guaranteed outcome.',
  },
  {
    category: 'fabricated_social_proof',
    severity: 'block',
    pattern:
      /\b(\d[\d,.]*\s*(?:\+\s*)?(?:happy\s+)?(?:customers?|clients?|reviews?|five[-\s]star)|rated\s+\d(?:\.\d)?\s*(?:\/|out\s+of)\s*5|trusted\s+by\s+\d)/gi,
    explanation: 'States a review count, rating or customer number that must come from real data.',
  },
  {
    category: 'unverifiable_superlative',
    severity: 'review',
    pattern:
      /\b(world'?s\s+(?:best|leading|finest)|number\s+one|#1\b|the\s+best\s+(?:in|on)\s+the\s+\w+|industry[-\s]leading|award[-\s]winning)\b/gi,
    explanation: 'Superlative or award claim that needs evidence.',
  },
  {
    category: 'invented_certification',
    severity: 'block',
    pattern:
      /\b(certified\s+(?:organic|vegan|fair[-\s]trade|cruelty[-\s]free)|ISO\s*\d{4,}|CE[-\s]certified|patented)\b/gi,
    explanation: 'Names a certification or patent that must be verified.',
  },
  {
    category: 'legal_or_financial_advice',
    severity: 'block',
    pattern: /\b(tax[-\s]deductible|legally\s+(?:required|entitled)|investment\s+advice|guaranteed\s+returns?)\b/gi,
    explanation: 'Gives legal or financial advice.',
  },
];

/**
 * Screens generated copy for forbidden assertions and unsupported figures.
 *
 * Returns findings; it does not mutate the copy. A `block` finding should stop
 * auto-publication and route to the approval inbox; a `review` finding is
 * advisory.
 */
export function screenGeneratedCopy(
  copy: string,
  options: { approvedFacts?: ApprovedFacts; brandBrain?: Pick<BrandBrain, 'guidelines'> | null } = {}
): FactualityFinding[] {
  const findings: FactualityFinding[] = [];
  if (!copy.trim()) return findings;

  for (const rule of FORBIDDEN_PATTERNS) {
    // Reset lastIndex — these are module-level /g regexes reused across calls.
    rule.pattern.lastIndex = 0;
    const matches = copy.match(rule.pattern);
    if (!matches) continue;

    for (const match of Array.from(new Set(matches)).slice(0, 5)) {
      findings.push({
        severity: rule.severity,
        category: rule.category,
        excerpt: match.trim(),
        explanation: rule.explanation,
      });
    }
  }

  // Brand-specific prohibited claims, matched as phrases.
  for (const claim of options.brandBrain?.guidelines?.prohibitedClaims ?? []) {
    const needle = claim.toLowerCase().trim();
    if (needle.length >= 8 && copy.toLowerCase().includes(needle)) {
      findings.push({
        severity: 'block',
        category: 'brand_prohibited_claim',
        excerpt: claim.slice(0, 120),
        explanation: 'Matches a claim this brand has explicitly prohibited.',
      });
    }
  }

  findings.push(...screenUnsupportedNumbers(copy, options.approvedFacts));

  return findings;
}

/**
 * Flags quantitative claims whose figure appears nowhere in the approved facts.
 *
 * Only measurement-shaped numbers are considered — a price, percentage, or a
 * number followed by a unit. Bare numerals ("3 ways to style it") are ignored,
 * because flagging every digit would make the guard useless in practice.
 */
function screenUnsupportedNumbers(copy: string, approvedFacts?: ApprovedFacts): FactualityFinding[] {
  const findings: FactualityFinding[] = [];

  const quantitative =
    /(?:[$£€]\s?\d[\d,.]*)|(?:\d[\d,.]*\s?%)|(?:\d[\d,.]*\s?(?:mg|g|kg|ml|l|oz|lb|cm|mm|m|in|ft|hours?|hrs?|days?|weeks?|months?|years?|minutes?|mins?))\b/gi;

  const matches = copy.match(quantitative);
  if (!matches) return findings;

  const approvedHaystack = [...(approvedFacts?.facts ?? []), ...(approvedFacts?.numbers ?? [])]
    .join(' ')
    .toLowerCase();

  for (const match of Array.from(new Set(matches)).slice(0, 8)) {
    const digits = match.replace(/[^\d.]/g, '');
    if (digits && approvedHaystack.includes(digits)) continue;

    findings.push({
      severity: 'review',
      category: 'unsupported_figure',
      excerpt: match.trim(),
      explanation:
        approvedHaystack.length > 0
          ? 'This figure does not appear in the approved facts.'
          : 'This figure cannot be verified — no approved facts are recorded for this product.',
    });
  }

  return findings;
}

/** True when anything found should stop automatic publication. */
export function hasBlockingFindings(findings: FactualityFinding[]): boolean {
  return findings.some((f) => f.severity === 'block');
}

/** One-line summary for an approval-inbox row. */
export function summarizeFindings(findings: FactualityFinding[]): string {
  if (findings.length === 0) return 'No factuality issues detected.';

  const blocking = findings.filter((f) => f.severity === 'block').length;
  const review = findings.length - blocking;

  const parts: string[] = [];
  if (blocking > 0) parts.push(`${blocking} blocking`);
  if (review > 0) parts.push(`${review} to review`);

  const categories = Array.from(new Set(findings.map((f) => f.category))).slice(0, 4).join(', ');
  return `${parts.join(', ')} (${categories})`;
}
