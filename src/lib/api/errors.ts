/**
 * One error shape for the whole API surface.
 *
 * Contract:
 *  - Clients receive `{ error, code, requestId }` and nothing else. No stack
 *    traces, no SQL text, no provider payloads, no internal identifiers.
 *  - The full detail is written to the structured server log against the same
 *    requestId, so support can join a user's screenshot to the real cause.
 *  - Anything thrown that is NOT an ApiError is treated as a 500 with a generic
 *    message — an unexpected failure can never leak its internals by accident.
 */
import { NextResponse } from 'next/server';
import { logger, newRequestId, type LogContext } from '@/lib/logger';

export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'payment_required'
  | 'conflict'
  | 'provider_unavailable'
  | 'not_configured'
  | 'internal';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  rate_limited: 429,
  payment_required: 402,
  conflict: 409,
  provider_unavailable: 502,
  not_configured: 503,
  internal: 500,
};

/** Safe, user-facing defaults. Never mention infrastructure. */
const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  unauthenticated: 'Please log in to continue.',
  forbidden: 'You do not have access to this resource.',
  not_found: 'We could not find what you were looking for.',
  invalid_request: 'Some of the details you sent were not valid.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  payment_required: 'Your plan does not include this action.',
  conflict: 'That action conflicts with the current state. Please refresh and try again.',
  provider_unavailable: 'An external service is temporarily unavailable. Please try again.',
  not_configured: 'This feature is not configured yet.',
  internal: 'Something went wrong on our end. Please try again.',
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Extra machine-readable hints that are safe to expose (e.g. field errors). */
  readonly details?: Record<string, unknown>;
  /** Server-only context — logged, never serialised to the client. */
  readonly internal?: unknown;

  constructor(
    code: ApiErrorCode,
    message?: string,
    options?: { details?: Record<string, unknown>; internal?: unknown }
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options?.details;
    this.internal = options?.internal;
  }

  static unauthenticated(message?: string) {
    return new ApiError('unauthenticated', message);
  }
  static forbidden(message?: string, internal?: unknown) {
    return new ApiError('forbidden', message, { internal });
  }
  static notFound(message?: string) {
    return new ApiError('not_found', message);
  }
  static invalid(message?: string, details?: Record<string, unknown>) {
    return new ApiError('invalid_request', message, { details });
  }
  static rateLimited(retryAfterSeconds: number) {
    return new ApiError('rate_limited', undefined, { details: { retryAfterSeconds } });
  }
  static paymentRequired(message: string) {
    return new ApiError('payment_required', message, { details: { upgradeRequired: true } });
  }
  static conflict(message?: string) {
    return new ApiError('conflict', message);
  }
  static notConfigured(message: string) {
    return new ApiError('not_configured', message);
  }
}

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  requestId: string;
  details?: Record<string, unknown>;
}

/**
 * Converts anything thrown inside a route handler into a safe NextResponse and
 * logs the real cause. Always returns — it never rethrows.
 */
export function toErrorResponse(error: unknown, context: LogContext = {}): NextResponse<ApiErrorBody> {
  const requestId = context.requestId ?? newRequestId();

  if (error instanceof ApiError) {
    // 4xx below 500 are expected control flow (bad input, no access) and are
    // logged at warn; 5xx are genuine faults and carry the throwable.
    const logContext = {
      ...context,
      requestId,
      code: error.code,
      status: error.status,
      message: error.message,
      internal: error.internal,
    };
    if (error.status >= 500) logger.error(`api_error:${error.code}`, error, logContext);
    else logger.warn(`api_error:${error.code}`, logContext);

    const headers: Record<string, string> = {};
    const retryAfter = error.details?.retryAfterSeconds;
    if (typeof retryAfter === 'number') headers['Retry-After'] = String(retryAfter);

    return NextResponse.json<ApiErrorBody>(
      {
        error: error.message,
        code: error.code,
        requestId,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status, headers }
    );
  }

  logger.error('api_error:unhandled', error, { ...context, requestId });

  return NextResponse.json<ApiErrorBody>(
    { error: DEFAULT_MESSAGE.internal, code: 'internal', requestId },
    { status: 500 }
  );
}

/**
 * Wraps a route handler so every thrown ApiError becomes a correct response and
 * every unexpected throw becomes a safe 500. Use this instead of hand-rolled
 * try/catch in each route.
 */
export function routeHandler<Args extends unknown[]>(
  route: string,
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    try {
      const response = await handler(...args);
      response.headers.set('x-request-id', requestId);
      return response;
    } catch (error) {
      const response = toErrorResponse(error, { route, requestId, durationMs: Date.now() - startedAt });
      response.headers.set('x-request-id', requestId);
      return response;
    }
  };
}
