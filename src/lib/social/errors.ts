/**
 * Provider error taxonomy.
 *
 * The single most important decision the publishing worker makes is what to do
 * with a failure, and there are only four useful answers:
 *
 *   retryable        — transient. Retry with backoff. Rate limits, 5xx, timeouts.
 *   permanent        — retrying cannot help. Bad media, rejected caption,
 *                      duplicate content. Fail the job and tell the user.
 *   needs_reconnect  — the credential is the problem: expired, revoked, or
 *                      missing a scope. Retrying is worse than useless because
 *                      it burns attempts while the user could be fixing it.
 *   unavailable      — we have no implementation for this platform. Never a
 *                      retry, never presented as the user's fault.
 *
 * Getting this wrong has a real cost in both directions: classifying a rate
 * limit as permanent throws away a scheduled post, and classifying a revoked
 * token as retryable retries five times over an hour and then reports a
 * confusing error instead of "reconnect your account".
 */

export type PublishErrorKind = 'retryable' | 'permanent' | 'needs_reconnect' | 'unavailable';

export class PublishError extends Error {
  readonly kind: PublishErrorKind;
  readonly code: string;
  /** The provider's own response, already stripped of credentials. */
  readonly providerResponse?: Record<string, unknown>;
  /** Provider-advised wait, in seconds, when it sent one. */
  readonly retryAfterSeconds?: number;

  constructor(
    kind: PublishErrorKind,
    code: string,
    message: string,
    options: { providerResponse?: Record<string, unknown>; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = 'PublishError';
    this.kind = kind;
    this.code = code;
    this.providerResponse = options.providerResponse;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get retryable(): boolean {
    return this.kind === 'retryable';
  }
}

/**
 * Meta error subcodes that mean "the credential is broken", not "try again".
 *
 * Meta returns HTTP 400 for most of these, so status alone cannot classify
 * them — a naive `status >= 500 ? retry : fail` would treat an expired token
 * as a permanent content failure and never prompt the user to reconnect.
 */
const META_AUTH_CODES = new Set([102, 190, 463, 464, 467, 2500]);
const META_AUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);
const META_PERMISSION_CODES = new Set([200, 3, 10]);

/** Meta rate limiting: application, page and user level all mean back off. */
const META_THROTTLE_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80003, 80004]);

/** Transient server-side problems. */
const META_TRANSIENT_CODES = new Set([1, 2, 341, 368]);

export interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

/**
 * Classifies a Meta Graph API failure.
 *
 * The user-facing message prefers `error_user_msg` when Meta supplies one:
 * it is written for end users, whereas `message` is written for developers
 * and often names internal fields.
 */
export function classifyMetaError(status: number, body: MetaErrorBody | null, retryAfterHeader?: string | null): PublishError {
  const error = body?.error;
  const code = error?.code;
  const subcode = error?.error_subcode;

  const providerResponse: Record<string, unknown> = {
    status,
    code: code ?? null,
    subcode: subcode ?? null,
    type: error?.type ?? null,
    message: error?.message ?? null,
    fbtrace_id: error?.fbtrace_id ?? null,
  };

  const userMessage = error?.error_user_msg || error?.message || `Meta returned HTTP ${status}.`;
  const retryAfterSeconds = parseRetryAfter(retryAfterHeader);

  // Order matters: a revoked token can arrive as a 400 alongside a permission
  // code, and "reconnect" is the more actionable of the two.
  if ((code !== undefined && META_AUTH_CODES.has(code)) || (subcode !== undefined && META_AUTH_SUBCODES.has(subcode))) {
    return new PublishError(
      'needs_reconnect',
      `meta_auth_${code ?? 'unknown'}${subcode ? `_${subcode}` : ''}`,
      `${userMessage} Reconnect the account to continue publishing.`,
      { providerResponse }
    );
  }

  if (code !== undefined && META_PERMISSION_CODES.has(code)) {
    return new PublishError(
      'needs_reconnect',
      `meta_permission_${code}`,
      `${userMessage} The connected account is missing a permission this post needs.`,
      { providerResponse }
    );
  }

  if (code !== undefined && META_THROTTLE_CODES.has(code)) {
    return new PublishError('retryable', `meta_throttled_${code}`, `${userMessage} Rate limited by Meta.`, {
      providerResponse,
      // Meta's throttles are measured in hours, so a default far longer than
      // the generic backoff.
      retryAfterSeconds: retryAfterSeconds ?? 900,
    });
  }

  if (code !== undefined && META_TRANSIENT_CODES.has(code)) {
    return new PublishError('retryable', `meta_transient_${code}`, userMessage, {
      providerResponse,
      retryAfterSeconds,
    });
  }

  if (status === 429) {
    return new PublishError('retryable', 'meta_http_429', userMessage, {
      providerResponse,
      retryAfterSeconds: retryAfterSeconds ?? 900,
    });
  }

  if (status >= 500) {
    return new PublishError('retryable', `meta_http_${status}`, userMessage, {
      providerResponse,
      retryAfterSeconds,
    });
  }

  if (status === 401 || status === 403) {
    return new PublishError('needs_reconnect', `meta_http_${status}`, `${userMessage} Reconnect the account.`, {
      providerResponse,
    });
  }

  // Everything else — malformed media, rejected caption, unsupported aspect
  // ratio — is the request's fault and will fail identically on a retry.
  return new PublishError('permanent', `meta_http_${status}_${code ?? 'unknown'}`, userMessage, {
    providerResponse,
  });
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds), 86_400);

  // Retry-After may also be an HTTP date.
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delta = Math.round((date - Date.now()) / 1000);
    if (delta > 0) return Math.min(delta, 86_400);
  }

  return undefined;
}

/** Classifies a thrown transport error (DNS, TLS, socket, abort). */
export function classifyTransportError(error: unknown): PublishError {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof Error && error.name === 'AbortError') {
    return new PublishError('retryable', 'timeout', 'The request to the platform timed out.');
  }

  return new PublishError('retryable', 'network_error', `Could not reach the platform: ${message}`);
}
