/**
 * Gemini adapter — retained as a fallback behind Claude.
 *
 * Kept rather than deleted for two reasons: it is working code that already
 * carries OwBrand's prompt conventions, and the master command asks for a
 * fallback architecture, which needs a second real provider to be worth
 * anything. It is never the primary unless AI_PROVIDER_ORDER says so.
 *
 * The old lib/gemini.ts remains only as a thin deprecated shim; all new call
 * sites go through lib/ai/generate.ts.
 */
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import {
  AIProviderError,
  type AIEffort,
  type AIGenerateRequest,
  type AIGenerateResult,
  type AIProvider,
  type AITask,
  type AITokenUsage,
} from '@/lib/ai/types';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const PRO_MODEL = 'gemini-2.0-pro';

/** USD per million tokens. */
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.0-pro': { input: 1.25, output: 5.0 },
};

const MAX_OUTPUT_TOKENS: Record<AITask, number> = {
  brand_brain: 8_192,
  website_generation: 8_192,
  marketing_analysis: 4_096,
  content_generation: 4_096,
  reel_script: 4_096,
  creative_brief: 4_096,
  copy_rewrite: 2_048,
  product_image_analysis: 2_048,
};

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new AIProviderError('not_configured', 'gemini', 'GEMINI_API_KEY is not set.');
  }
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
}

export const geminiProvider: AIProvider = {
  id: 'gemini',
  displayName: 'Gemini (Google)',

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY);
  },

  supportsVision() {
    return true;
  },

  supportsStructuredOutput() {
    // Gemini supports a response MIME type of application/json, but not the
    // schema-constrained decoding Claude offers. Reported honestly so the
    // validation layer knows to lean on its repair ladder here.
    return false;
  },

  modelFor(task: AITask, effort: AIEffort): string {
    if (effort === 'high') return process.env.GEMINI_MODEL_PRO || PRO_MODEL;
    return process.env.GEMINI_MODEL || DEFAULT_MODEL;
  },

  estimateCostUsd(model: string, usage: AITokenUsage): number {
    const price = PRICING[model] ?? PRICING[DEFAULT_MODEL];
    return (usage.inputTokens / 1_000_000) * price.input + (usage.outputTokens / 1_000_000) * price.output;
  },

  async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
    const effort = request.effort ?? 'medium';
    const model = this.modelFor(request.task, effort);
    const maxTokens = request.maxOutputTokens ?? MAX_OUTPUT_TOKENS[request.task] ?? 4_096;
    const startedAt = Date.now();

    try {
      const generativeModel: GenerativeModel = getClient().getGenerativeModel({
        model,
        systemInstruction: request.system,
        generationConfig: {
          maxOutputTokens: maxTokens,
          responseMimeType: request.jsonSchema ? 'application/json' : 'text/plain',
        },
      });

      // Gemini has no multi-turn param on generateContent in this SDK shape;
      // messages are flattened, which is fine because OwBrand's calls are
      // single-turn instructions.
      const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

      for (const image of request.images ?? []) {
        parts.push({ inlineData: { data: image.base64, mimeType: image.mediaType } });
      }
      parts.push({ text: request.messages.map((m) => m.content).join('\n\n') });

      const result = await withTimeout(
        generativeModel.generateContent(parts),
        request.timeoutMs ?? 120_000
      );

      const text = result.response.text();
      const meta = result.response.usageMetadata;

      const usage: AITokenUsage = {
        inputTokens: meta?.promptTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
      };

      // Gemini signals a safety block via an empty candidate list plus a
      // promptFeedback block reason.
      const blockReason = result.response.promptFeedback?.blockReason;
      if (blockReason) {
        return {
          text: '',
          usage,
          provider: 'gemini',
          model,
          latencyMs: Date.now() - startedAt,
          refused: true,
          refusalCategory: String(blockReason),
        };
      }

      if (!text.trim()) {
        throw new AIProviderError('malformed_output', 'gemini', 'Model returned no text.');
      }

      return { text, usage, provider: 'gemini', model, latencyMs: Date.now() - startedAt };
    } catch (error) {
      throw classifyError(error);
    }
  },
};

/**
 * The Gemini SDK has no per-request timeout option, so one is imposed here.
 * Without it a hung request would hold a serverless invocation to its hard
 * limit.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AIProviderError('timeout', 'gemini', `Timed out after ${ms}ms.`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The Gemini SDK does not expose typed error classes, so status codes are read
 * off the error shape. This is the one place string inspection is unavoidable;
 * it is confined to a single function.
 */
function classifyError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const status = extractStatus(error, message);

  if (status === 429) {
    return new AIProviderError('rate_limited', 'gemini', 'Provider rate limit reached.', {
      status,
      cause: error,
    });
  }
  if (status === 401 || status === 403) {
    return new AIProviderError('authentication', 'gemini', 'Provider rejected our credentials.', {
      status,
      cause: error,
    });
  }
  if (status === 400) {
    return new AIProviderError('invalid_request', 'gemini', message, { status, cause: error });
  }
  if (status && status >= 500) {
    return new AIProviderError('overloaded', 'gemini', 'Provider is unavailable.', { status, cause: error });
  }
  if (/fetch failed|network|ECONNRESET|ENOTFOUND/i.test(message)) {
    return new AIProviderError('connection', 'gemini', 'Could not reach the provider.', { cause: error });
  }
  if (/safety|blocked/i.test(message)) {
    return new AIProviderError('content_filtered', 'gemini', 'Request was blocked by a safety filter.', {
      cause: error,
    });
  }

  return new AIProviderError('unknown', 'gemini', message, { cause: error });
}

function extractStatus(error: unknown, message: string): number | undefined {
  const direct = (error as { status?: number })?.status;
  if (typeof direct === 'number') return direct;

  const match = message.match(/\[(\d{3})[^\]]*\]|\b(\d{3})\b/);
  const code = Number(match?.[1] ?? match?.[2]);
  return Number.isFinite(code) && code >= 400 && code < 600 ? code : undefined;
}
