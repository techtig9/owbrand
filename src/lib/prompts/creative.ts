/**
 * Creative prompts — reels and product vision.
 *
 * These replace the reel/vision prompt builders in lib/prompts/content.ts,
 * which were shaped around the Gemini call signature (systemPrompt +
 * userPrompt strings). The new AI layer takes a system prompt and a user turn,
 * and applies the factuality contract itself.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Reel / video script
 * ------------------------------------------------------------------ */

export const reelScriptSchema = z.object({
  concept: z.string().trim().min(1).max(500),
  hook: z.string().trim().min(1).max(300),
  durationSeconds: z.number().int().min(5).max(90),
  aspectRatio: z.enum(['9:16', '1:1', '16:9']).default('9:16'),
  scenes: z
    .array(
      z.object({
        order: z.number().int().min(1).max(30),
        durationSeconds: z.number().min(0.5).max(30),
        /** What the viewer sees. Drives the compositing layer. */
        visual: z.string().trim().min(1).max(600),
        /** On-screen text. Kept short — it has to be readable on a phone. */
        onScreenText: z.string().trim().max(120).default(''),
        voiceover: z.string().trim().max(500).default(''),
        /** Which supplied asset this scene uses, by index. */
        sourceAssetIndex: z.number().int().min(0).max(50).nullable().default(null),
        transition: z.enum(['cut', 'fade', 'slide', 'zoom']).default('cut'),
      })
    )
    .min(2)
    .max(12),
  caption: z.string().trim().max(2200).default(''),
  hashtags: z.array(z.string().trim().max(60)).max(15).default([]),
  cta: z.string().trim().max(200).default(''),
  musicDirection: z.string().trim().max(300).default(''),
});

export type ReelScript = z.infer<typeof reelScriptSchema>;

export const reelScriptJsonSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['concept', 'hook', 'durationSeconds', 'scenes'],
  properties: {
    concept: { type: 'string' },
    hook: { type: 'string' },
    durationSeconds: { type: 'integer' },
    aspectRatio: { type: 'string', enum: ['9:16', '1:1', '16:9'] },
    caption: { type: 'string' },
    cta: { type: 'string' },
    musicDirection: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['order', 'durationSeconds', 'visual'],
        properties: {
          order: { type: 'integer' },
          durationSeconds: { type: 'number' },
          visual: { type: 'string' },
          onScreenText: { type: 'string' },
          voiceover: { type: 'string' },
          sourceAssetIndex: { type: ['integer', 'null'] },
          transition: { type: 'string', enum: ['cut', 'fade', 'slide', 'zoom'] },
        },
      },
    },
  },
} as const;

export function reelSystemRole(): string {
  return [
    'You are OwBrand’s short-form video director. You plan reels that stop a thumb',
    'in the first second and still say something true.',
    '',
    'Return a single JSON object matching the requested shape. No markdown fence.',
    '',
    'Craft rules:',
    '- The hook occupies the first 1.5 seconds and must work with the sound off.',
    '- On-screen text is at most a short phrase per scene; nobody reads a paragraph.',
    '- Scene durations must sum to roughly the requested total.',
    '- Reference supplied assets by index in sourceAssetIndex; use null when a',
    '  scene needs footage that does not exist yet, and describe it in `visual`.',
    '',
    'Do not script a spoken or on-screen claim you cannot support from the approved',
    'facts. A voiceover asserting a benefit the product has not been verified to have',
    'is the same violation as writing it in an ad.',
  ].join('\n');
}

export function reelUserPrompt(input: {
  instruction: string;
  durationSeconds: number;
  aspectRatio: string;
  assets: Array<{ index: number; caption: string | null; type?: string }>;
}): string {
  const assetLines = input.assets.length
    ? input.assets
        .map((a) => `  [${a.index}] ${a.type ?? 'asset'}${a.caption ? ` — ${a.caption}` : ''}`)
        .join('\n')
    : '  (none supplied)';

  return [
    `Target duration: ${input.durationSeconds} seconds`,
    `Aspect ratio: ${input.aspectRatio}`,
    '',
    'Available source assets:',
    assetLines,
    '',
    `Brief: ${input.instruction}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Product vision analysis
 * ------------------------------------------------------------------ */

/**
 * What a vision pass may return.
 *
 * Note `legible` on visibleText and `confidence` on each extracted fact: the
 * model is required to say when it cannot read something, rather than guessing
 * at a label. Everything here is stored UNVERIFIED.
 */
export const productVisionSchema = z.object({
  productDetected: z.boolean(),
  productType: z.string().trim().max(120).default(''),
  packagingDetails: z.string().trim().max(1000).default(''),
  visibleText: z
    .array(
      z.object({
        text: z.string().trim().max(300),
        legible: z.boolean().default(true),
      })
    )
    .max(20)
    .default([]),
  dominantColors: z.array(z.string().trim().max(30)).max(8).default([]),
  shape: z.string().trim().max(200).default(''),
  materialOrFinish: z.string().trim().max(200).default(''),
  imageQuality: z.enum(['excellent', 'good', 'acceptable', 'poor']).default('acceptable'),
  background: z.string().trim().max(300).default(''),
  /** Problems that would hurt a generated creative. */
  risks: z.array(z.string().trim().max(300)).max(10).default([]),
  creativeGuidance: z.string().trim().max(1500).default(''),
  /**
   * Candidate facts for the Product Brain. Stored unverified — a human
   * confirms them before anything may quote them.
   */
  extractedFacts: z
    .array(
      z.object({
        fact: z.string().trim().min(3).max(300),
        category: z
          .enum([
            'general',
            'specification',
            'material',
            'dimension',
            'price',
            'ingredient',
            'certification',
            'benefit',
            'usage',
            'care',
            'warranty',
          ])
          .default('general'),
        numericValue: z.string().trim().max(50).optional(),
        unit: z.string().trim().max(20).optional(),
        confidence: z.enum(['high', 'medium', 'low']).default('medium'),
      })
    )
    .max(20)
    .default([]),
});

export type ProductVision = z.infer<typeof productVisionSchema>;

export const productVisionJsonSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['productDetected'],
  properties: {
    productDetected: { type: 'boolean' },
    productType: { type: 'string' },
    packagingDetails: { type: 'string' },
    shape: { type: 'string' },
    materialOrFinish: { type: 'string' },
    background: { type: 'string' },
    creativeGuidance: { type: 'string' },
    imageQuality: { type: 'string', enum: ['excellent', 'good', 'acceptable', 'poor'] },
    dominantColors: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    visibleText: { type: 'array', items: { type: 'object', additionalProperties: true } },
    extractedFacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
} as const;

export function productVisionUserPrompt(context: {
  brandName: string;
  productName: string;
  productDescription?: string;
}): string {
  return [
    `Brand: ${context.brandName}`,
    `Product: ${context.productName}`,
    context.productDescription ? `Owner’s description: ${context.productDescription}` : null,
    '',
    'Describe what is visible in this photograph.',
  ]
    .filter(Boolean)
    .join('\n');
}
