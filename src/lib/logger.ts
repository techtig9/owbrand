/**
 * Structured server-side logging with automatic secret redaction.
 *
 * Every log line is a single JSON object so it is queryable in Vercel / Datadog
 * / CloudWatch without a custom parser. Nothing here ever reaches the browser:
 * user-facing errors are produced by lib/api/errors.ts, which deliberately
 * carries no stack traces, SQL text or provider payloads.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Keys whose values are never printed, matched case-insensitively as substrings. */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'credential',
  'service_role',
  'servicerole',
  'signature',
  'privatekey',
  'private_key',
  'access_token',
  'refresh_token',
];

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-\s]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern.replace(/[-_\s]/g, '')));
}

/**
 * Deep-redacts an arbitrary value before it is serialised.
 * Handles cycles, Errors, Maps/Sets and over-deep structures.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      // Stack is kept server-side only; it is never sent to a client response.
      stack: value.stack,
    };
  }

  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1, seen));
  }

  if (value instanceof Map) return redact(Object.fromEntries(value), depth + 1, seen);
  if (value instanceof Set) return redact(Array.from(value), depth + 1, seen);

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1, seen);
  }
  return out;
}

export interface LogContext {
  /** Correlates every line emitted while handling one HTTP request. */
  requestId?: string;
  // Nullable because callers frequently hold `string | null` for an optional
  // subject (an anonymous request, an unowned record) and should not have to
  // coerce just to log it.
  userId?: string | null;
  workspaceId?: string | null;
  brandId?: string | null;
  route?: string;
  durationMs?: number;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const line = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  });

  // Only console.error/console.warn are unbuffered-safe across runtimes; info
  // and debug intentionally share console.log.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'production') return;
    emit('debug', message, context);
  },
  info(message: string, context?: LogContext) {
    emit('info', message, context);
  },
  warn(message: string, context?: LogContext) {
    emit('warn', message, context);
  },
  error(message: string, error?: unknown, context?: LogContext) {
    emit('error', message, { ...context, error: redact(error) });
  },
};

/** Stable identifier for one request, used to tie a user-facing error to its server log. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
