/**
 * Claude (Anthropic) adapter — OwBrand's primary AI provider.
 *
 * Notes on the current API surface, since several older patterns are now
 * rejected outright:
 *   - Thinking is `{ type: 'adaptive' }`. `budget_tokens` returns a 400 on
 *     Opus 5 and is not sent.
 *   - Depth is controlled by `output_config.effort`, not by a token budget.
 *   - Assistant prefill is removed; response shape is steered with
 *     `output_config.format` (structured outputs) instead.
 *   - `stop_reason: 'refusal'` arrives as HTTP 200. It must be checked BEFORE
 *     reading content, and it is not a transport error — retrying an identical
 *     prompt declines again.
 */
import Anthropic from '@anthropic-ai/sdk';
// The error classes are top-level named exports, not members of the Anthropic
// namespace — `Anthropic.APIError` works for `instanceof` but is not a type.
import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import {
  AIProviderError,
  type AIEffort,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIProvider,
  type AITask,
  type AITokenUsage,
} from '@/lib/ai/types';

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * USD per million tokens. Kept beside the adapter so cost accounting cannot
 * silently drift from the model actually used.
 */
const PRICING: Record<string, { input: number; output: number; cachedInput: number }> = {
  'claude-opus-5': { input: 5.0, output: 25.0, cachedInput: 0.5 },
  'claude-sonnet-5': { input: 2.0, output: 10.0, cachedInput: 0.2 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cachedInput: 0.1 },
};

/**
 * Effort per task. Brand Brain and website generation are the two places where
 * quality most obviously compounds — everything downstream is generated from
 * the Brand Brain — so they get more headroom than routine copy.
 */
const TASK_EFFORT: Record<AITask, AIEffort> = {
  brand_brain: 'high',
  website_generation: 'high',
  marketing_analysis: 'high',
  content_generation: 'medium',
  reel_script: 'medium',
  creative_brief: 'medium',
  copy_rewrite: 'low',
  product_image_analysis: 'low',
};

const MAX_OUTPUT_TOKENS: Record<AITask, number> = {
  brand_brain: 16_000,
  website_generation: 32_000,
  marketing_analysis: 8_000,
  content_generation: 8_000,
  reel_script: 8_000,
  creative_brief: 8_000,
  copy_rewrite: 4_000,
  product_image_analysis: 4_000,
};

/** Streaming is required above this, or the request risks an HTTP timeout. */
const STREAMING_THRESHOLD_TOKENS = 16_000;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AIProviderError('not_configured', 'anthropic', 'ANTHROPIC_API_KEY is not set.');
  }
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // The resilience layer owns retries so behaviour is identical across
      // providers; the SDK's own retry would double-count attempts and hide
      // failures from our health tracking.
      maxRetries: 0,
      timeout: DEFAULT_TIMEOUT_MS, // milliseconds in the TS SDK
    });
  }
  return client;
}

export const anthropicProvider: AIProvider = {
  id: 'anthropic',
  displayName: 'Claude (Anthropic)',

  isConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  supportsVision() {
    return true;
  },

  supportsStructuredOutput() {
    return true;
  },

  modelFor() {
    return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  },

  estimateCostUsd(model: string, usage: AITokenUsage): number {
    const price = PRICING[model] ?? PRICING[DEFAULT_MODEL];
    const cached = usage.cachedInputTokens ?? 0;
    const uncachedInput = Math.max(0, usage.inputTokens - cached);

    return (
      (uncachedInput / 1_000_000) * price.input +
      (cached / 1_000_000) * price.cachedInput +
      (usage.outputTokens / 1_000_000) * price.output
    );
  },

  async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
    const model = this.modelFor(request.task, request.effort ?? 'medium');
    const effort = request.effort ?? TASK_EFFORT[request.task] ?? 'medium';
    const maxTokens = request.maxOutputTokens ?? MAX_OUTPUT_TOKENS[request.task] ?? 8_000;
    const startedAt = Date.now();

    const params = buildParams(request, model, effort, maxTokens);

    try {
      const anthropic = getClient();
      const options = request.timeoutMs ? { timeout: request.timeoutMs } : undefined;

      // Large outputs must stream or the HTTP request can time out before the
      // model finishes.
      const message =
        maxTokens > STREAMING_THRESHOLD_TOKENS
          ? await anthropic.messages.stream(params, options).finalMessage()
          : await anthropic.messages.create(params, options);

      const usage: AITokenUsage = {
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
        cachedInputTokens: message.usage.cache_read_input_tokens ?? 0,
      };

      // Checked BEFORE reading content: a refusal is a 200 with no useful body.
      if (message.stop_reason === 'refusal') {
        return {
          text: '',
          usage,
          provider: 'anthropic',
          model: message.model ?? model,
          latencyMs: Date.now() - startedAt,
          refused: true,
          refusalCategory: message.stop_details?.category ?? null,
        };
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      if (!text.trim()) {
        throw new AIProviderError(
          'malformed_output',
          'anthropic',
          `Model returned no text (stop_reason: ${message.stop_reason}).`
        );
      }

      return {
        text,
        usage,
        provider: 'anthropic',
        model: message.model ?? model,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw classifyError(error);
    }
  },
};

/* ------------------------------------------------------------------ *
 * Request construction
 * ------------------------------------------------------------------ */

function buildParams(
  request: AIGenerateRequest,
  model: string,
  effort: AIEffort,
  maxTokens: number
): Anthropic.MessageCreateParamsNonStreaming {
  const messages: Anthropic.MessageParam[] = request.messages.map((message, index) => {
    // Images ride on the first user turn, before its text — the documented
    // ordering for vision requests.
    if (index === 0 && message.role === 'user' && request.images?.length) {
      const content: Anthropic.ContentBlockParam[] = [
        ...request.images.map(
          (image): Anthropic.ContentBlockParam => ({
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
          })
        ),
        { type: 'text', text: message.content },
      ];
      return { role: 'user', content };
    }
    return { role: message.role, content: message.content };
  });

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    // The system prompt is stable per task, so it is the natural cache prefix.
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages,
    thinking: { type: 'adaptive' },
    output_config: { effort },
  };

  if (request.jsonSchema) {
    params.output_config = {
      ...params.output_config,
      format: {
        type: 'json_schema',
        schema: request.jsonSchema.schema,
      },
    } as Anthropic.MessageCreateParams['output_config'];
  }

  return params;
}

/* ------------------------------------------------------------------ *
 * Error classification
 * ------------------------------------------------------------------ */

/**
 * Maps the SDK's typed errors onto our vendor-neutral kinds, most specific
 * first. String-matching error messages is deliberately avoided.
 */
function classifyError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;

  if (error instanceof APIUserAbortError) {
    return new AIProviderError('timeout', 'anthropic', 'Request was aborted.', { cause: error });
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new AIProviderError('timeout', 'anthropic', 'Provider timed out.', { cause: error });
  }

  if (error instanceof APIConnectionError) {
    return new AIProviderError('connection', 'anthropic', 'Could not reach the provider.', {
      cause: error,
    });
  }

  if (error instanceof RateLimitError) {
    return new AIProviderError('rate_limited', 'anthropic', 'Provider rate limit reached.', {
      status: error.status,
      retryAfterSeconds: parseRetryAfter(error),
      cause: error,
    });
  }

  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new AIProviderError('authentication', 'anthropic', 'Provider rejected our credentials.', {
      status: error.status,
      cause: error,
    });
  }

  if (error instanceof BadRequestError) {
    return new AIProviderError('invalid_request', 'anthropic', error.message, {
      status: error.status,
      cause: error,
    });
  }

  if (error instanceof InternalServerError) {
    return new AIProviderError('overloaded', 'anthropic', 'Provider is unavailable.', {
      status: error.status,
      cause: error,
    });
  }

  if (error instanceof APIError) {
    const status = error.status ?? 0;
    const kind = status === 529 || status >= 500 ? 'overloaded' : 'unknown';
    return new AIProviderError(kind, 'anthropic', error.message, { status, cause: error });
  }

  return new AIProviderError('unknown', 'anthropic', 'Unexpected provider failure.', { cause: error });
}

function parseRetryAfter(error: APIError): number | undefined {
  const headers = (error as { headers?: Record<string, string> | Headers }).headers;
  if (!headers) return undefined;

  const raw =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('retry-after')
      : (headers as Record<string, string>)['retry-after'];

  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
