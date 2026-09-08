/**
 * The single AI entry point for the whole product.
 *
 * Everything above this — routes, Brand Brain, Creative Studio — calls
 * `generateStructured` or `generateText` and nothing else. That is what makes
 * the guarantees below universal rather than per-route:
 *
 *   - a provider chain with retry, backoff and failover
 *   - schema validation before any value is returned
 *   - the repair -> retry -> fail ladder for malformed JSON
 *   - a usage row for every call, successful or not
 *   - errors that are safe to show a user
 *
 * No API key ever reaches the browser: this module is server-only and every
 * adapter reads its credential from the environment at call time.
 */
import 'server-only';
import type { ZodTypeAny, output as ZodOutput } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { logger, newRequestId } from '@/lib/logger';
import { generateWithFailover, type FailoverAttempt } from '@/lib/ai/resilience';
import { parseJsonLoosely } from '@/lib/ai/json-repair';
import { recordAIUsage, type AIUsageStatus } from '@/lib/ai/usage';
import { hasUsableProvider } from '@/lib/ai/registry';
import {
  AIProviderError,
  type AIGenerateRequest,
  type AIStructuredResult,
  type AITask,
  type AITokenUsage,
} from '@/lib/ai/types';

/** Who this generation is for. Drives usage attribution. */
export interface GenerationContext {
  userId?: string | null;
  workspaceId?: string | null;
  brandId?: string | null;
  jobId?: string | null;
  /** Credits reserved for this action, recorded against the usage row. */
  creditsCharged?: number;
}

export interface GenerateOptions extends Omit<AIGenerateRequest, 'messages' | 'system' | 'task'> {
  task: AITask;
  system: string;
  prompt: string;
  context?: GenerationContext;
}

/* ------------------------------------------------------------------ *
 * Plain text
 * ------------------------------------------------------------------ */

export async function generateText(options: GenerateOptions): Promise<{
  text: string;
  provider: string;
  model: string;
  usage: AITokenUsage;
}> {
  const requestId = newRequestId();
  assertProviderAvailable();

  const request: AIGenerateRequest = {
    task: options.task,
    system: options.system,
    messages: [{ role: 'user', content: options.prompt }],
    images: options.images,
    effort: options.effort,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMs: options.timeoutMs,
  };

  try {
    const result = await generateWithFailover(request, { requestId });

    if (result.refused) {
      await record(options, result.provider, result.model, result.usage, 'refused', result.refusalCategory);
      throw refusalError(result.refusalCategory);
    }

    await record(options, result.provider, result.model, result.usage, 'success');

    return { text: result.text, provider: result.provider, model: result.model, usage: result.usage };
  } catch (error) {
    throw await handleFailure(error, options, requestId);
  }
}

/* ------------------------------------------------------------------ *
 * Structured (schema-validated) output
 * ------------------------------------------------------------------ */

/*
 * The generic is the SCHEMA, not the result. `ZodType<T>` expands to
 * `ZodType<T, ZodTypeDef, T>`, which makes TypeScript bind T to Zod's INPUT
 * type and leaves every `.default()` field optional at the call site — see the
 * same note in lib/api/validate.ts.
 */
export interface GenerateStructuredOptions<S extends ZodTypeAny> extends GenerateOptions {
  schema: S;
  /** JSON Schema handed to providers that support constrained decoding. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Extra whole-generation attempts when validation fails. */
  maxValidationRetries?: number;
}

/**
 * Generates and validates. A caller receives typed, schema-conformant data or
 * an error — never raw text, and never an unvalidated object.
 *
 * The ladder, in order:
 *   1. parse; on failure apply deterministic repairs (fences, trailing commas,
 *      surrounding prose)
 *   2. validate against the Zod schema
 *   3. on failure, regenerate with the validation errors fed back to the model
 *   4. after the retry budget, raise a friendly error so the caller refunds
 */
export async function generateStructured<S extends ZodTypeAny>(
  options: GenerateStructuredOptions<S>
): Promise<AIStructuredResult<ZodOutput<S>>> {
  const requestId = newRequestId();
  assertProviderAvailable();

  const maxRetries = options.maxValidationRetries ?? 1;
  const totalUsage: AITokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  let attempts = 0;
  let lastValidationError = '';
  let lastProvider = 'unknown';
  let lastModel = 'unknown';
  let allAttempts: FailoverAttempt[] = [];

  try {
    for (let round = 0; round <= maxRetries; round++) {
      attempts += 1;

      const prompt =
        round === 0
          ? options.prompt
          : // Feed the validation failure back rather than retrying blind. The
            // model is told exactly which field was wrong.
            `${options.prompt}\n\nYour previous response could not be used. Fix exactly these problems and return the corrected JSON only:\n${lastValidationError}`;

      const request: AIGenerateRequest = {
        task: options.task,
        system: options.system,
        messages: [{ role: 'user', content: prompt }],
        images: options.images,
        effort: options.effort,
        maxOutputTokens: options.maxOutputTokens,
        timeoutMs: options.timeoutMs,
        jsonSchema: options.jsonSchema,
      };

      const result = await generateWithFailover(request, { requestId });
      lastProvider = result.provider;
      lastModel = result.model;
      allAttempts = allAttempts.concat(result.attempts);

      totalUsage.inputTokens += result.usage.inputTokens;
      totalUsage.outputTokens += result.usage.outputTokens;
      totalUsage.cachedInputTokens =
        (totalUsage.cachedInputTokens ?? 0) + (result.usage.cachedInputTokens ?? 0);

      if (result.refused) {
        await record(options, lastProvider, lastModel, totalUsage, 'refused', result.refusalCategory);
        throw refusalError(result.refusalCategory);
      }

      // Rung 1: parse, repairing deterministically where we safely can.
      const parsed = parseJsonLoosely(result.text);
      if (!parsed) {
        lastValidationError = 'The response was not valid JSON. Return a single JSON object and nothing else.';
        logger.warn('ai:unparseable_output', {
          requestId,
          task: options.task,
          provider: lastProvider,
          round,
          preview: result.text.slice(0, 200),
        });
        continue;
      }

      if (parsed.repairs.length > 0) {
        logger.info('ai:output_repaired', {
          requestId,
          task: options.task,
          provider: lastProvider,
          repairs: parsed.repairs,
        });
      }

      // Rung 2: validate the shape.
      const validation = options.schema.safeParse(parsed.value);
      if (validation.success) {
        await record(options, lastProvider, lastModel, totalUsage, 'success');

        return {
          data: validation.data,
          raw: result.text,
          usage: totalUsage,
          provider: lastProvider,
          model: lastModel,
          latencyMs: result.latencyMs,
          attempts,
          viaFallback: result.viaFallback,
        };
      }

      lastValidationError = formatValidationErrors(validation.error);
      logger.warn('ai:schema_validation_failed', {
        requestId,
        task: options.task,
        provider: lastProvider,
        round,
        errors: lastValidationError.slice(0, 500),
      });
    }

    // Rung 4: out of budget.
    await record(options, lastProvider, lastModel, totalUsage, 'failed', 'schema_validation_failed');

    logger.error('ai:structured_generation_exhausted', undefined, {
      requestId,
      task: options.task,
      attempts,
      lastValidationError: lastValidationError.slice(0, 500),
    });

    throw new ApiError('provider_unavailable', 'The AI could not produce a usable result. Please try again.');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw await handleFailure(error, options, requestId);
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function assertProviderAvailable(): void {
  if (!hasUsableProvider()) {
    // Honest: do not claim a provider is available when no credential exists.
    throw ApiError.notConfigured(
      'AI generation is not configured yet. An administrator needs to add an AI provider key.'
    );
  }
}

function refusalError(category?: string | null): ApiError {
  logger.warn('ai:refusal_surfaced', { category });
  return new ApiError(
    'invalid_request',
    'The AI declined this request. Try rephrasing it, or adjust the brand rules it conflicts with.'
  );
}

/** Turns Zod issues into instructions the model can act on. */
function formatValidationErrors(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return error.issues
    .slice(0, 12)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `- ${path}: ${issue.message}`;
    })
    .join('\n');
}

async function record(
  options: GenerateOptions,
  provider: string,
  model: string,
  usage: AITokenUsage,
  status: AIUsageStatus,
  errorCode?: string | null
): Promise<void> {
  await recordAIUsage({
    userId: options.context?.userId ?? null,
    workspaceId: options.context?.workspaceId ?? null,
    brandId: options.context?.brandId ?? null,
    jobId: options.context?.jobId ?? null,
    provider,
    model,
    task: options.task,
    usage,
    status,
    errorCode: errorCode ?? null,
    creditsCharged: options.context?.creditsCharged ?? 0,
  });
}

/**
 * Converts a provider failure into a safe, actionable ApiError, and records the
 * usage row for the failed call. Provider internals never reach the client.
 */
async function handleFailure(
  error: unknown,
  options: GenerateOptions,
  requestId: string
): Promise<ApiError> {
  if (error instanceof ApiError) return error;

  if (error instanceof AIProviderError) {
    const status: AIUsageStatus =
      error.kind === 'timeout' ? 'timeout' : error.kind === 'rate_limited' ? 'rate_limited' : 'failed';

    await record(
      options,
      error.provider,
      'unknown',
      { inputTokens: 0, outputTokens: 0 },
      status,
      error.kind
    );

    logger.error('ai:generation_failed', error, {
      requestId,
      task: options.task,
      provider: error.provider,
      kind: error.kind,
    });

    switch (error.kind) {
      case 'not_configured':
        return ApiError.notConfigured(
          'AI generation is not configured yet. An administrator needs to add an AI provider key.'
        );
      case 'rate_limited':
        return new ApiError(
          'provider_unavailable',
          'The AI service is busy right now. Please try again in a moment.'
        );
      case 'timeout':
        return new ApiError(
          'provider_unavailable',
          'That generation took too long. Try again, or simplify the request.'
        );
      case 'content_filtered':
        return new ApiError(
          'invalid_request',
          'The AI declined this request. Try rephrasing it.'
        );
      case 'authentication':
        // A credential problem is ours, not the user's — say nothing specific.
        return new ApiError('provider_unavailable', 'The AI service is unavailable. Please try again shortly.');
      default:
        return new ApiError('provider_unavailable', 'AI generation failed. Please try again.');
    }
  }

  logger.error('ai:generation_failed_unexpected', error, { requestId, task: options.task });
  return new ApiError('internal');
}
