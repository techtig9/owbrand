/**
 * AI usage and cost accounting.
 *
 * The master command requires cost/usage logging by workspace, user and job.
 * Before Phase 2 there was none — `ai_jobs` existed in the schema and was never
 * written to, and no route recorded a token count or a dollar figure.
 *
 * Every generation writes exactly one row here, whether it succeeded, failed,
 * timed out or was refused. Failures matter most: they are the ones that cost
 * money without producing anything, and without a row they are invisible.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { getProvider } from '@/lib/ai/registry';
import type { AITask, AITokenUsage } from '@/lib/ai/types';

type Db = SupabaseClient<any, any, any>;

export type AIUsageStatus = 'success' | 'failed' | 'timeout' | 'rate_limited' | 'refused';

export interface RecordUsageInput {
  userId?: string | null;
  workspaceId?: string | null;
  brandId?: string | null;
  jobId?: string | null;
  provider: string;
  model: string;
  task: AITask;
  usage: AITokenUsage;
  latencyMs?: number;
  status: AIUsageStatus;
  errorCode?: string | null;
  /** Credits the user was actually charged for this generation. */
  creditsCharged?: number;
}

/**
 * Writes one usage row. Never throws — accounting must not be able to fail a
 * generation the user already paid for.
 */
export async function recordAIUsage(input: RecordUsageInput, db: Db = supabaseAdmin()): Promise<void> {
  const costUsd = estimateCost(input.provider, input.model, input.usage);

  try {
    const { error } = await db.from('ai_usage_logs').insert({
      user_id: input.userId ?? null,
      workspace_id: input.workspaceId ?? null,
      brand_id: input.brandId ?? null,
      job_id: input.jobId ?? null,
      provider: input.provider,
      model: input.model,
      task: input.task,
      input_tokens: input.usage.inputTokens,
      output_tokens: input.usage.outputTokens,
      estimated_cost_usd: Number(costUsd.toFixed(6)),
      latency_ms: input.latencyMs ?? null,
      status: input.status,
      error_code: input.errorCode ?? null,
      credits_charged: input.creditsCharged ?? 0,
    });

    if (error) {
      logger.warn('ai_usage:write_failed', { provider: input.provider, error: String(error.message) });
    }
  } catch (error) {
    logger.warn('ai_usage:write_threw', { provider: input.provider, error: String(error) });
  }
}

/** Delegates to the provider that owns the pricing for that model. */
export function estimateCost(providerId: string, model: string, usage: AITokenUsage): number {
  const provider = getProvider(providerId);
  if (!provider) return 0;
  try {
    return provider.estimateCostUsd(model, usage);
  } catch {
    return 0;
  }
}

export interface UsageSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  generations: number;
  failures: number;
  byProvider: Record<string, { costUsd: number; generations: number }>;
}

/**
 * Rolls up a workspace's spend over a window. Backs the usage dashboard and
 * lets an operator see cost per tenant without a manual query.
 */
export async function summarizeUsage(
  options: { workspaceId?: string; userId?: string; sinceDays?: number },
  db: Db = supabaseAdmin()
): Promise<UsageSummary> {
  const since = new Date(Date.now() - (options.sinceDays ?? 30) * 86_400_000).toISOString();

  let query = db
    .from('ai_usage_logs')
    .select('provider, estimated_cost_usd, input_tokens, output_tokens, status')
    .gte('created_at', since);

  if (options.workspaceId) query = query.eq('workspace_id', options.workspaceId);
  if (options.userId) query = query.eq('user_id', options.userId);

  const empty: UsageSummary = {
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    generations: 0,
    failures: 0,
    byProvider: {},
  };

  try {
    const { data, error } = await query;
    if (error || !data) return empty;

    return (data as Array<Record<string, any>>).reduce<UsageSummary>((acc, row) => {
      const cost = Number(row.estimated_cost_usd ?? 0);
      acc.totalCostUsd += cost;
      acc.totalInputTokens += Number(row.input_tokens ?? 0);
      acc.totalOutputTokens += Number(row.output_tokens ?? 0);
      acc.generations += 1;
      if (row.status !== 'success') acc.failures += 1;

      const provider = String(row.provider ?? 'unknown');
      const bucket = acc.byProvider[provider] ?? { costUsd: 0, generations: 0 };
      bucket.costUsd += cost;
      bucket.generations += 1;
      acc.byProvider[provider] = bucket;

      return acc;
    }, empty);
  } catch (error) {
    logger.warn('ai_usage:summary_failed', { error: String(error) });
    return empty;
  }
}
