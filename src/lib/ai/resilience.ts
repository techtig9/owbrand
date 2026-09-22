/**
 * Retry, backoff and failover.
 *
 * Before Phase 2 there was none of this: a single Gemini call with no timeout,
 * no retry and no alternative. A hung provider held the serverless invocation
 * to its hard limit and a transient 529 surfaced to the user as a failed
 * generation with their credits refunded.
 *
 * Policy:
 *   1. Try each provider in the chain, in order.
 *   2. Within a provider, retry only genuinely retryable failures — rate
 *      limits, timeouts, overload, connection errors. A 400 is our bug and
 *      will fail identically on the next attempt.
 *   3. Back off exponentially with full jitter, honouring Retry-After when the
 *      provider supplies it.
 *   4. Move to the next provider once a provider is exhausted, unless the
 *      failure would fail everywhere (invalid request, content filter).
 *   5. Record health so a persistently failing provider is skipped for a while.
 */
import { AIProviderError, type AIGenerateRequest, type AIGenerateResult, type AIProvider } from '@/lib/ai/types';
import { recordProviderFailure, recordProviderSuccess, selectProviders } from '@/lib/ai/registry';
import { logger } from '@/lib/logger';

export interface RetryPolicy {
  /** Attempts per provider, including the first. */
  maxAttemptsPerProvider: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Cap on how long a provider is allowed to keep us waiting. */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttemptsPerProvider: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxRetryAfterMs: 20_000,
};

/**
 * Exponential backoff with FULL jitter.
 *
 * Full jitter (a uniform sample in [0, delay]) rather than the delay itself:
 * when several requests fail at the same instant — which is exactly what a
 * provider outage causes — fixed backoff makes them all retry simultaneously
 * and re-create the thundering herd.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const exponential = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return Math.floor(Math.random() * exponential);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GenerateWithFailoverOptions {
  policy?: RetryPolicy;
  /** Overrides the registry's chain. Used by tests and by pinned requests. */
  providers?: AIProvider[];
  /** Correlates every log line for one logical generation. */
  requestId?: string;
}

export interface FailoverAttempt {
  provider: string;
  attempt: number;
  outcome: 'success' | 'retryable_error' | 'fatal_error' | 'refused';
  kind?: string;
  latencyMs?: number;
}

export interface GenerateWithFailoverResult extends AIGenerateResult {
  /** Every provider call made, in order. Useful for debugging and cost audit. */
  attempts: FailoverAttempt[];
}

/**
 * Runs one generation across the provider chain with retry and failover.
 * Throws the last AIProviderError when every provider is exhausted.
 */
export async function generateWithFailover(
  request: AIGenerateRequest,
  options: GenerateWithFailoverOptions = {}
): Promise<GenerateWithFailoverResult> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const attempts: FailoverAttempt[] = [];

  const chain =
    options.providers ??
    selectProviders({
      requireVision: Boolean(request.images?.length),
      requireStructuredOutput: Boolean(request.jsonSchema),
    }).chain;

  if (chain.length === 0) {
    throw new AIProviderError(
      'not_configured',
      'none',
      'No AI provider is configured. Set ANTHROPIC_API_KEY (or configure AI_PROVIDER_ORDER).'
    );
  }

  let lastError: AIProviderError | null = null;

  for (const [providerIndex, provider] of chain.entries()) {
    for (let attempt = 1; attempt <= policy.maxAttemptsPerProvider; attempt++) {
      try {
        const result = await provider.generate(request);

        // A refusal is a decision, not a fault. Do not retry it and do not
        // mark the provider unhealthy — but do try the next provider, whose
        // policy may differ.
        if (result.refused) {
          attempts.push({ provider: provider.id, attempt, outcome: 'refused', latencyMs: result.latencyMs });
          recordProviderSuccess(provider.id);

          logger.warn('ai:provider_refused', {
            requestId: options.requestId,
            provider: provider.id,
            task: request.task,
            category: result.refusalCategory,
          });

          const isLastProvider = providerIndex === chain.length - 1;
          if (isLastProvider) {
            return { ...result, attempts, viaFallback: providerIndex > 0 };
          }
          break; // next provider
        }

        attempts.push({ provider: provider.id, attempt, outcome: 'success', latencyMs: result.latencyMs });
        recordProviderSuccess(provider.id);

        return { ...result, attempts, viaFallback: providerIndex > 0 };
      } catch (error) {
        const providerError =
          error instanceof AIProviderError
            ? error
            : new AIProviderError('unknown', provider.id, 'Unexpected provider failure.', { cause: error });

        lastError = providerError;

        const canRetryHere = providerError.retryable && attempt < policy.maxAttemptsPerProvider;

        attempts.push({
          provider: provider.id,
          attempt,
          outcome: canRetryHere ? 'retryable_error' : 'fatal_error',
          kind: providerError.kind,
        });

        // A misconfigured or unreachable provider counts against its health;
        // our own bad request does not.
        if (providerError.kind !== 'invalid_request') {
          recordProviderFailure(provider.id, `${providerError.kind}: ${providerError.message}`);
        }

        logger.warn('ai:provider_attempt_failed', {
          requestId: options.requestId,
          provider: provider.id,
          task: request.task,
          attempt,
          kind: providerError.kind,
          status: providerError.status,
          willRetry: canRetryHere,
        });

        if (canRetryHere) {
          const delay = providerError.retryAfterSeconds
            ? Math.min(providerError.retryAfterSeconds * 1000, policy.maxRetryAfterMs)
            : backoffDelayMs(attempt, policy);
          await sleep(delay);
          continue;
        }

        // Not retryable here. Either move on, or give up entirely if the
        // failure would repeat on every provider.
        if (!providerError.failoverable) {
          throw providerError;
        }
        break; // next provider
      }
    }
  }

  throw (
    lastError ??
    new AIProviderError('unknown', 'none', 'Every AI provider failed without reporting a reason.')
  );
}
