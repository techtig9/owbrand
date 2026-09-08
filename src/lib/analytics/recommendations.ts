import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateStructured } from '@/lib/ai/generate';
import { buildBrandContext } from '@/lib/brand/guard';
import { getCurrentBrandBrain } from '@/lib/brand/store';
import { confidenceBand, type Signal } from './signals';
import { isConfigured } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Turns detected signals into stored recommendations.
 *
 * The division of labour is the important part, and it is deliberate:
 *
 *   signals.ts  decides WHETHER something is happening, from the data alone.
 *   this module  decides how to SAY it.
 *
 * The AI never sees the raw metrics and is never asked whether a signal
 * exists. It receives the observation sentence and the evidence that were
 * already computed, and writes an explanation and a concrete action in the
 * brand's voice. It therefore cannot invent a number, and if it is
 * unconfigured or fails, the deterministic observation is stored instead — so
 * a recommendation always exists, always cites its evidence, and is never
 * fabricated.
 *
 * `confidence` and `sample_size` are stored with every row. The master command
 * requires a confidence level and source metrics; a recommendation the user
 * cannot audit is indistinguishable from one we made up, and the database
 * refuses a row with empty evidence.
 */

type Db = SupabaseClient<any, any, any>;

const recommendationSchema = z.object({
  /** Short, specific, and about this observation. */
  title: z.string().trim().min(1).max(120),
  /** What to do and why, in the brand's voice. */
  recommendation: z.string().trim().min(1).max(1200),
});

const recommendationJsonSchema = {
  name: 'recommendation',
  schema: {
    type: 'object',
    additionalProperties: true,
    required: ['title', 'recommendation'],
    properties: {
      title: { type: 'string' },
      recommendation: { type: 'string' },
    },
  },
} as const;

export interface StoredRecommendation {
  id: string;
  signal: string;
  title: string;
  recommendation: string;
  priority: string;
  confidence: number | null;
  evidence: Record<string, unknown>;
  sampleSize: number | null;
  generatedBy: string;
}

export interface GenerateOptions {
  brandId: string;
  workspaceId: string | null;
  windowDays: number;
  signals: Signal[];
  db?: Db;
  /** Skips the AI phrasing pass. Used when a caller wants the raw signals. */
  skipNarrative?: boolean;
}

export async function generateRecommendations(
  options: GenerateOptions
): Promise<{ recommendations: StoredRecommendation[]; narrativeUsed: boolean }> {
  const db = options.db ?? supabaseAdmin();
  const stored: StoredRecommendation[] = [];

  // A signal saying "there is not enough data" is worth recording once, but it
  // is not a recommendation and must not be dressed up as one by the AI.
  const actionable = options.signals.filter((signal) => signal.kind !== 'insufficient_data');
  const useNarrative = !options.skipNarrative && isConfigured.ai() && actionable.length > 0;

  let brandContext = '';
  if (useNarrative) {
    brandContext = await loadBrandContext(options.brandId, db);
  }

  let narrativeUsed = false;

  for (const signal of options.signals) {
    let title = defaultTitle(signal);
    let text = signal.observation;
    let generatedBy = 'deterministic';
    let model: string | null = null;

    if (useNarrative && signal.kind !== 'insufficient_data') {
      const phrased = await phraseSignal(signal, brandContext, options.windowDays);
      if (phrased) {
        title = phrased.title;
        // The observation is PREPENDED, not replaced. The audited fact stays
        // in the text no matter what the model wrote.
        text = `${signal.observation}\n\n${phrased.recommendation}`;
        generatedBy = 'ai';
        model = phrased.model;
        narrativeUsed = true;
      }
    }

    const row = await persist(
      {
        brandId: options.brandId,
        workspaceId: options.workspaceId,
        signal,
        title,
        recommendation: text,
        windowDays: options.windowDays,
        generatedBy,
        model,
      },
      db
    );

    if (row) stored.push(row);
  }

  logger.info('recommendations:generated', {
    brandId: options.brandId,
    signals: options.signals.length,
    stored: stored.length,
    narrativeUsed,
  });

  return { recommendations: stored, narrativeUsed };
}

async function loadBrandContext(brandId: string, db: Db): Promise<string> {
  try {
    const brain = await getCurrentBrandBrain(brandId, db);
    return brain ? buildBrandContext(brain) : '';
  } catch (error) {
    // Brand voice is a nicety here; its absence must not stop a recommendation.
    logger.info('recommendations:brand_context_unavailable', {
      brandId,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Asks the model to phrase one signal.
 *
 * Returns null on any failure. A recommendation with a deterministic
 * observation and no AI prose is strictly better than none, and far better
 * than an AI-invented one.
 */
async function phraseSignal(
  signal: Signal,
  brandContext: string,
  windowDays: number
): Promise<{ title: string; recommendation: string; model: string } | null> {
  const system = [
    'You are a marketing analyst writing one recommendation for a brand.',
    '',
    'CRITICAL RULES:',
    '- Every number you use must appear in the OBSERVATION or EVIDENCE below.',
    '  You have no other data. Do not estimate, extrapolate or add figures.',
    '- Do not restate the observation; the user already sees it. Explain what',
    '  it likely means and give one concrete, specific next action.',
    '- Do not promise an outcome. Say what to try and what to watch.',
    '- No preamble, no sign-off.',
    brandContext ? '' : null,
    brandContext,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const prompt = [
    `OBSERVATION: ${signal.observation}`,
    '',
    `EVIDENCE (the only numbers available to you):`,
    ...Object.entries(signal.evidence).map(([key, value]) => `- ${key}: ${value ?? 'not measured'}`),
    '',
    `MEASUREMENT WINDOW: ${windowDays} days`,
    `CONFIDENCE IN THIS SIGNAL: ${confidenceBand(signal.confidence)} (${signal.confidence})`,
    `SUGGESTED ACTION CATEGORY: ${signal.actionType}`,
    '',
    confidenceBand(signal.confidence) === 'low'
      ? 'Confidence is low. Say so, and frame the action as a test rather than a fix.'
      : '',
    '',
    'Return a short title (under 12 words) and a recommendation of 2-4 sentences.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const result = await generateStructured({
      task: 'marketing_analysis',
      schema: recommendationSchema,
      jsonSchema: recommendationJsonSchema,
      system,
      prompt,
      maxOutputTokens: 600,
      effort: 'low',
    });

    return { ...result.data, model: result.model };
  } catch (error) {
    logger.warn('recommendations:narrative_failed', {
      signal: signal.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function persist(
  input: {
    brandId: string;
    workspaceId: string | null;
    signal: Signal;
    title: string;
    recommendation: string;
    windowDays: number;
    generatedBy: string;
    model: string | null;
  },
  db: Db
): Promise<StoredRecommendation | null> {
  const { data, error } = await db.rpc('upsert_recommendation', {
    p_brand_id: input.brandId,
    p_workspace_id: input.workspaceId,
    p_signal: input.signal.kind,
    p_title: input.title,
    p_recommendation: input.recommendation,
    p_priority: input.signal.priority,
    p_action_type: input.signal.actionType,
    p_confidence: input.signal.confidence,
    p_evidence: input.signal.evidence,
    p_window_days: input.windowDays,
    p_sample_size: input.signal.sampleSize,
    p_generated_by: input.generatedBy,
    p_model: input.model,
  });

  if (error) {
    logger.warn('recommendations:persist_failed', {
      brandId: input.brandId,
      signal: input.signal.kind,
      error: String(error.message),
    });
    return null;
  }

  const row = data as Record<string, unknown> | null;
  if (!row) return null;

  return {
    id: String(row.id),
    signal: input.signal.kind,
    title: input.title,
    recommendation: input.recommendation,
    priority: input.signal.priority,
    confidence: input.signal.confidence,
    evidence: input.signal.evidence,
    sampleSize: input.signal.sampleSize,
    generatedBy: input.generatedBy,
  };
}

/** A usable title when the AI is unavailable. Never vague. */
function defaultTitle(signal: Signal): string {
  const titles: Record<string, string> = {
    insufficient_data: 'Not enough data to advise yet',
    engagement_declining: 'Engagement rate is falling',
    engagement_improving: 'Engagement rate is climbing',
    ctr_weak: 'Click-through rate has dropped',
    reach_declining: 'Reach is falling',
    top_format_outperforming: 'Your best posts are far ahead of the rest',
    posting_cadence_low: 'Posting cadence is low',
    roas_negative: 'Ad spend is exceeding attributed revenue',
    roas_strong: 'Ad spend is returning well',
    unattributed_revenue: 'Much of your revenue cannot be attributed',
  };

  return titles[signal.kind] ?? 'Performance signal detected';
}
