/**
 * The AI provider boundary.
 *
 * Before Phase 2, OwBrand called Gemini directly from five routes through
 * `lib/gemini.ts`, whose own header declared itself "owbrand's ONLY external AI
 * service". There was no interface, no fallback, no timeout, no retry, no
 * schema validation and no cost accounting — and the product direction is
 * Claude-based.
 *
 * Everything above this boundary (routes, Brand Brain, Creative Studio) speaks
 * only in these types. Everything below is a swappable adapter.
 */
import type { ZodType } from 'zod';

/** Coarse task label. Drives model selection and cost attribution. */
export type AITask =
  | 'brand_brain'
  | 'content_generation'
  | 'website_generation'
  | 'reel_script'
  | 'creative_brief'
  | 'product_image_analysis'
  | 'marketing_analysis'
  | 'copy_rewrite';

/** How much thinking/effort a task warrants. Mapped per provider. */
export type AIEffort = 'low' | 'medium' | 'high';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** An image supplied to a vision-capable model. */
export interface AIImageInput {
  /** Raw base64, no data: prefix. */
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

export interface AIGenerateRequest {
  task: AITask;
  /** Stable instructions. Placed where the provider can cache them. */
  system: string;
  /** The turn(s). Most calls are a single user message. */
  messages: AIMessage[];
  images?: AIImageInput[];
  effort?: AIEffort;
  maxOutputTokens?: number;
  /**
   * When set, the provider is asked for JSON matching this schema and the
   * result is validated before it is returned. Callers never see raw text.
   */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  /** Per-request override; otherwise the provider's default applies. */
  timeoutMs?: number;
}

export interface AITokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the provider's prompt cache, when reported. */
  cachedInputTokens?: number;
}

export interface AIGenerateResult {
  text: string;
  usage: AITokenUsage;
  /** Provider id that actually served the request. */
  provider: string;
  model: string;
  /** Wall-clock time for the provider call. */
  latencyMs: number;
  /**
   * True when the model declined the request on safety grounds rather than
   * failing. Callers must not treat this as a transport error — retrying an
   * identical prompt will decline again.
   */
  refused?: boolean;
  refusalCategory?: string | null;
  /** True when a fallback provider served this after the primary failed. */
  viaFallback?: boolean;
}

/**
 * Why a provider call failed. Retryability is a property of the KIND, not of
 * the provider, so the resilience layer can make one decision for all adapters.
 */
export type AIErrorKind =
  | 'rate_limited'
  | 'timeout'
  | 'overloaded'
  | 'connection'
  | 'invalid_request'
  | 'authentication'
  | 'not_configured'
  | 'content_filtered'
  | 'malformed_output'
  | 'unknown';

export class AIProviderError extends Error {
  readonly kind: AIErrorKind;
  readonly provider: string;
  readonly status?: number;
  /** Seconds the provider asked us to wait, when it said so. */
  readonly retryAfterSeconds?: number;

  constructor(
    kind: AIErrorKind,
    provider: string,
    message: string,
    options?: { status?: number; retryAfterSeconds?: number; cause?: unknown }
  ) {
    super(message);
    this.name = 'AIProviderError';
    this.kind = kind;
    this.provider = provider;
    this.status = options?.status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    if (options?.cause) this.cause = options.cause;
  }

  /** Whether retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return (
      this.kind === 'rate_limited' ||
      this.kind === 'timeout' ||
      this.kind === 'overloaded' ||
      this.kind === 'connection'
    );
  }

  /** Whether failing over to a different provider could plausibly succeed. */
  get failoverable(): boolean {
    // An invalid request is our bug and will fail identically everywhere;
    // a content filter is a decision, not an outage.
    return this.kind !== 'invalid_request' && this.kind !== 'content_filtered';
  }
}

/**
 * What every adapter must implement.
 *
 * Adapters are thin: they translate to and from one vendor's SDK and classify
 * that vendor's errors. Retry, timeout, failover, validation and accounting all
 * live above them so behaviour is identical whichever vendor serves a request.
 */
export interface AIProvider {
  /** Stable identifier used in logs, usage rows and env configuration. */
  readonly id: string;

  /** Human-readable name for admin surfaces. */
  readonly displayName: string;

  /** True only when this provider's credentials are actually present. */
  isConfigured(): boolean;

  /** Whether this provider can accept images in a request. */
  supportsVision(): boolean;

  /** Whether this provider can be asked for schema-constrained JSON. */
  supportsStructuredOutput(): boolean;

  /** The model id this provider would use for a task, for reporting. */
  modelFor(task: AITask, effort: AIEffort): string;

  /** Cost of a completed call, in USD. */
  estimateCostUsd(model: string, usage: AITokenUsage): number;

  generate(request: AIGenerateRequest): Promise<AIGenerateResult>;
}

/** Result of a validated, schema-checked generation. */
export interface AIStructuredResult<T> {
  data: T;
  raw: string;
  usage: AITokenUsage;
  provider: string;
  model: string;
  latencyMs: number;
  /** How many provider calls it took, including repair attempts. */
  attempts: number;
  viaFallback?: boolean;
}

/** Convenience alias for the schema a caller supplies. */
export type AISchema<T> = ZodType<T>;

/**
 * Trims a long input (a brand description, imported page content) to a
 * token-safe size. Moved here from the retired lib/gemini.ts, which was the
 * only reason two dead prompt files still imported it.
 */
export function trimForPrompt(input: string, maxChars = 6000): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n…(truncated)`;
}
