/**
 * The Brand Brain schema.
 *
 * This is the single source of truth the master command describes: every
 * downstream generation (copy, creative, campaigns, website, recommendations)
 * is produced FROM this object, so its shape has to be validated before it is
 * ever stored. Previously `/api/ai/build-brand` did a bare `JSON.parse` on the
 * model's output and spread the result across five tables unchecked — a missing
 * or renamed field silently produced an empty brand.
 *
 * Two conventions worth knowing:
 *
 *  - Almost every field is optional with a default. A model that omits
 *    `vocabulary.avoided` should not fail the whole generation; it should get
 *    an empty list. Only the fields the product genuinely cannot function
 *    without are required.
 *  - `approvedClaims` / `prohibitedClaims` are load-bearing, not decoration.
 *    They drive the factuality guard in lib/brand/guard.ts.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const shortText = text(200);
const mediumText = text(1000);
const longText = text(4000);

/** Bounded list, so a runaway generation cannot write 10,000 rows. */
const list = <T extends z.ZodTypeAny>(item: T, max = 24) => z.array(item).max(max);

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour like #2E5BFF');

export const brandColorSchema = z.object({
  name: shortText.default(''),
  hex: hexColorSchema,
  /** primary | secondary | accent | neutral | … — free-form but bounded. */
  role: shortText.default(''),
});

export const personaSchema = z.object({
  name: shortText,
  description: mediumText.default(''),
  age_range: shortText.default(''),
  goals: list(shortText, 8).default([]),
  painPoints: list(shortText, 8).default([]),
  channels: list(shortText, 8).default([]),
});

export const competitorSchema = z.object({
  name: shortText,
  positioning: mediumText.default(''),
  /** How OwBrand's customer differs from them. */
  differentiation: mediumText.default(''),
});

export const contentPillarSchema = z.object({
  name: shortText,
  description: mediumText.default(''),
  /** Rough share of the content mix, 0-100. */
  weight: z.number().min(0).max(100).default(0),
});

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

export const businessSchema = z.object({
  industry: shortText.default(''),
  businessType: shortText.default(''),
  location: shortText.default(''),
  targetMarkets: list(shortText, 12).default([]),
  goals: list(shortText, 12).default([]),
  /** What the business actually sells, in one line. */
  offering: mediumText.default(''),
});

export const positioningSchema = z.object({
  /** The single most important sentence in the Brand Brain. */
  usp: mediumText,
  statement: longText.default(''),
  mission: mediumText.default(''),
  vision: mediumText.default(''),
  values: list(shortText, 10).default([]),
  differentiators: list(mediumText, 10).default([]),
  competitors: list(competitorSchema, 10).default([]),
  /** Where the brand sits: premium, accessible, challenger, … */
  marketPosition: shortText.default(''),
});

export const audienceSchema = z.object({
  summary: mediumText.default(''),
  personas: list(personaSchema, 6).default([]),
  painPoints: list(mediumText, 12).default([]),
  desires: list(mediumText, 12).default([]),
  objections: list(mediumText, 12).default([]),
});

export const voiceSchema = z.object({
  voice: mediumText.default(''),
  tone: list(shortText, 10).default([]),
  personality: list(shortText, 10).default([]),
  /** Words to lean on, and words never to use. */
  preferredWords: list(shortText, 30).default([]),
  avoidedWords: list(shortText, 30).default([]),
  writingRules: list(mediumText, 15).default([]),
  /** A worked example so the tone is demonstrated, not just described. */
  exampleCopy: mediumText.default(''),
});

export const visualIdentitySchema = z.object({
  colors: list(brandColorSchema, 12).default([]),
  fonts: z
    .object({
      heading: shortText.default(''),
      body: shortText.default(''),
      accent: shortText.default(''),
    })
    .default({ heading: '', body: '', accent: '' }),
  photography: z
    .object({
      style: mediumText.default(''),
      lighting: shortText.default(''),
      composition: shortText.default(''),
      subjects: list(shortText, 10).default([]),
      avoid: list(shortText, 10).default([]),
    })
    .default({ style: '', lighting: '', composition: '', subjects: [], avoid: [] }),
  logoRules: z
    .object({
      clearSpace: shortText.default(''),
      minimumSize: shortText.default(''),
      dos: list(shortText, 10).default([]),
      donts: list(shortText, 10).default([]),
    })
    .default({ clearSpace: '', minimumSize: '', dos: [], donts: [] }),
  /** Overall visual direction in one line. */
  direction: mediumText.default(''),
});

export const guidelinesSchema = z.object({
  doRules: list(mediumText, 20).default([]),
  dontRules: list(mediumText, 20).default([]),
  /**
   * FACTUALITY BOUNDARY. Only these claims may appear in generated content.
   * Anything the AI cannot support from this list must not be asserted.
   */
  approvedClaims: list(mediumText, 30).default([]),
  /**
   * Claims that must never appear, whatever the prompt asks for. The master
   * command's forbidden categories (medical, legal, guarantees, fabricated
   * testimonials) are seeded here by DEFAULT_PROHIBITED_CLAIMS.
   */
  prohibitedClaims: list(mediumText, 30).default([]),
  complianceNotes: mediumText.default(''),
});

export const contentStrategySchema = z.object({
  pillars: list(contentPillarSchema, 8).default([]),
  formats: list(shortText, 12).default([]),
  postingCadence: shortText.default(''),
  hooks: list(mediumText, 12).default([]),
  ctas: list(shortText, 12).default([]),
});

export const brandRecommendationSchema = z.object({
  title: shortText,
  recommendation: longText,
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  rationale: mediumText.default(''),
});

/* ------------------------------------------------------------------ *
 * The whole object
 * ------------------------------------------------------------------ */

export const brandBrainSchema = z.object({
  /** Required: the two things without which nothing downstream works. */
  name: shortText,
  tagline: mediumText,

  business: businessSchema.default({
    industry: '',
    businessType: '',
    location: '',
    targetMarkets: [],
    goals: [],
    offering: '',
  }),
  positioning: positioningSchema,
  audience: audienceSchema.default({
    summary: '',
    personas: [],
    painPoints: [],
    desires: [],
    objections: [],
  }),
  voice: voiceSchema.default({
    voice: '',
    tone: [],
    personality: [],
    preferredWords: [],
    avoidedWords: [],
    writingRules: [],
    exampleCopy: '',
  }),
  visualIdentity: visualIdentitySchema.default({
    colors: [],
    fonts: { heading: '', body: '', accent: '' },
    photography: { style: '', lighting: '', composition: '', subjects: [], avoid: [] },
    logoRules: { clearSpace: '', minimumSize: '', dos: [], donts: [] },
    direction: '',
  }),
  guidelines: guidelinesSchema.default({
    doRules: [],
    dontRules: [],
    approvedClaims: [],
    prohibitedClaims: [],
    complianceNotes: '',
  }),
  contentStrategy: contentStrategySchema.default({
    pillars: [],
    formats: [],
    postingCadence: '',
    hooks: [],
    ctas: [],
  }),
  story: longText.default(''),
  recommendations: list(brandRecommendationSchema, 10).default([]),
});

export type BrandBrain = z.infer<typeof brandBrainSchema>;
export type BrandColor = z.infer<typeof brandColorSchema>;
export type BrandPersona = z.infer<typeof personaSchema>;
export type BrandRecommendation = z.infer<typeof brandRecommendationSchema>;

/**
 * Claim categories that are never permitted, regardless of what a user or a
 * prompt asks for. Merged into every brand's prohibited list so the guard
 * enforces them even on a brand created before this existed.
 */
export const DEFAULT_PROHIBITED_CLAIMS: readonly string[] = [
  'Medical, health or therapeutic claims (treats, cures, prevents, heals, clinically proven)',
  'Guarantees of results, income, or outcomes',
  'Fabricated customer testimonials, reviews or ratings',
  'Invented certifications, awards, endorsements or accreditations',
  'Unverifiable superlatives (world’s best, number one, fastest)',
  'Competitor disparagement or unverified comparative claims',
  'Invented statistics, study results or performance figures',
  'Legal or financial advice',
  'Claims about safety for children, pregnancy or medical conditions',
];

/**
 * JSON Schema for providers that support constrained decoding.
 *
 * Deliberately hand-written and loose rather than generated from the Zod
 * schema: constrained decoding rejects many JSON Schema features, and an
 * over-specified schema makes the model fail the call rather than produce
 * slightly-off output that our repair ladder would happily fix. Zod remains the
 * real gate.
 */
export const brandBrainJsonSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['name', 'tagline', 'positioning'],
  properties: {
    name: { type: 'string' },
    tagline: { type: 'string' },
    story: { type: 'string' },
    business: { type: 'object', additionalProperties: true },
    positioning: {
      type: 'object',
      additionalProperties: true,
      required: ['usp'],
      properties: { usp: { type: 'string' } },
    },
    audience: { type: 'object', additionalProperties: true },
    voice: { type: 'object', additionalProperties: true },
    visualIdentity: { type: 'object', additionalProperties: true },
    guidelines: { type: 'object', additionalProperties: true },
    contentStrategy: { type: 'object', additionalProperties: true },
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
} as const satisfies Record<string, unknown>;
