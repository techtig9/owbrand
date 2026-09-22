/**
 * Brand Brain prompts.
 *
 * Written for a current reasoning model: the task and the constraints are
 * stated, then it is left to work. Older prompt habits — step-by-step
 * scaffolding, "think carefully", repeated emphasis — reduce output quality on
 * these models and are deliberately absent.
 *
 * The system prompt is stable per generation type so it sits inside the
 * provider's cached prefix; everything that varies goes in the user turn.
 */
import { buildFactualityInstructions } from '@/lib/brand/guard';

export interface BrandBrainBriefInput {
  brandName: string;
  description: string;
  industry?: string;
  location?: string;
  targetMarkets?: string[];
  goals?: string[];
}

/**
 * The system prompt for building a Brand Brain from a business description.
 *
 * Note what it does NOT ask for: invented statistics, competitor names it has
 * not been given, or claims about the product. A Brand Brain is a strategy
 * document, and strategy can be reasoned from a description — facts cannot.
 */
export function brandBrainSystemPrompt(): string {
  return [
    'You are OwBrand’s brand strategist. You turn a business description into a',
    'complete, usable brand system that every later piece of content is generated from.',
    '',
    'Return a single JSON object matching the requested shape. No prose, no markdown',
    'fence, no commentary before or after.',
    '',
    'What good looks like:',
    '- The USP is one specific sentence a competitor could not also claim.',
    '- Personas are recognisable people with real motivations, not demographic buckets.',
    '- Voice is demonstrated with example copy, not just adjectives.',
    '- Content pillars are things this business can credibly talk about every week.',
    '- Colours are hex values chosen for the positioning, with a stated role.',
    '',
    'Strategy is yours to reason about. FACTS ARE NOT.',
    '',
    'You have only the description you were given. Do not invent prices, materials,',
    'ingredients, dimensions, certifications, awards, review counts, customer numbers,',
    'founding dates, team size, or named competitors that were not supplied. If the',
    'description does not establish something, leave the field empty rather than',
    'filling it with something plausible.',
    '',
    'In `guidelines.approvedClaims`, list ONLY claims directly supported by the',
    'description. If the description supports none, return an empty array — an empty',
    'array is a correct answer, an invented claim is not.',
  ].join('\n');
}

export function brandBrainUserPrompt(input: BrandBrainBriefInput): string {
  const lines = [
    `Business name: ${input.brandName}`,
    input.industry ? `Industry: ${input.industry}` : null,
    input.location ? `Location: ${input.location}` : null,
    input.targetMarkets?.length ? `Target markets: ${input.targetMarkets.join(', ')}` : null,
    input.goals?.length ? `Stated goals: ${input.goals.join(', ')}` : null,
    '',
    'Description provided by the owner:',
    input.description,
  ].filter(Boolean);

  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Content generation
 * ------------------------------------------------------------------ */

export type ContentKind = 'post' | 'caption' | 'ad' | 'email' | 'headline' | 'product_story';

export interface ContentPromptInput {
  kind: ContentKind;
  instruction: string;
  platform?: string;
  brandContext: string;
  factualityInstructions: string;
}

const KIND_GUIDANCE: Record<ContentKind, string> = {
  post: 'A social post. Lead with the hook; earn the second line.',
  caption: 'A caption for an image or video. Short, and it must not describe what is already visible.',
  ad: 'Paid ad copy. One clear promise, one clear action.',
  email: 'A marketing email. Subject line, preheader, body, single call to action.',
  headline: 'Headline options. Each must work standing alone.',
  product_story: 'The story of a product — why it exists and who it is for.',
};

export function contentSystemPrompt(input: Pick<ContentPromptInput, 'kind' | 'brandContext' | 'factualityInstructions'>): string {
  return [
    'You write for OwBrand. Every piece of copy you produce sounds like it came from',
    'this brand and no other.',
    '',
    KIND_GUIDANCE[input.kind],
    '',
    'Return a single JSON object matching the requested shape. No markdown fence.',
    '',
    '--- BRAND ---',
    input.brandContext,
    '',
    '--- CONSTRAINTS ---',
    input.factualityInstructions,
  ].join('\n');
}

export function contentUserPrompt(input: Pick<ContentPromptInput, 'instruction' | 'platform'>): string {
  return [input.platform ? `Platform: ${input.platform}` : null, `Brief: ${input.instruction}`]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * Product image analysis
 * ------------------------------------------------------------------ */

/**
 * Vision analysis of an uploaded product photo.
 *
 * The critical framing: everything it returns is a PROPOSAL requiring human
 * verification, not a fact. The extracted facts are stored unverified for
 * exactly this reason.
 */
export function productVisionSystemPrompt(): string {
  return [
    'You are OwBrand’s product vision analyst. You describe what is actually visible',
    'in a product photograph so the creative tools can preserve the product’s real',
    'identity.',
    '',
    'Return a single JSON object matching the requested shape. No markdown fence.',
    '',
    'Report only what you can see. Do not infer the material from the look, the price',
    'from the styling, or the contents from the packaging. If text on the label is not',
    'legible, say so rather than guessing at it.',
    '',
    'Everything you return is treated as an unverified suggestion for a human to',
    'confirm. Being uncertain and saying so is more useful than being confident and',
    'wrong — a wrong "fact" confirmed by a distracted human becomes a claim this brand',
    'then makes in public.',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Shared assembly
 * ------------------------------------------------------------------ */

/**
 * Composes the brand context and the factuality contract into one system
 * prompt. Every generation route uses this so the guarantees are identical
 * across the product.
 */
export function assembleSystemPrompt(options: {
  role: string;
  brandContext?: string;
  brandBrain?: Parameters<typeof buildFactualityInstructions>[0]['brandBrain'];
  approvedFacts?: Parameters<typeof buildFactualityInstructions>[0]['approvedFacts'];
  productName?: string;
  extra?: string;
}): string {
  const sections = [options.role];

  if (options.brandContext) {
    sections.push('', '--- BRAND ---', options.brandContext);
  }

  sections.push(
    '',
    '--- CONSTRAINTS ---',
    buildFactualityInstructions({
      brandBrain: options.brandBrain ?? null,
      approvedFacts: options.approvedFacts,
      productName: options.productName,
    })
  );

  if (options.extra) sections.push('', options.extra);

  return sections.join('\n');
}
