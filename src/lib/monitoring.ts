import 'server-only';
import { logger } from '@/lib/logger';

/**
 * The error-reporting seam.
 *
 * No monitoring vendor is wired in, and this file does not pretend one is. It
 * exists so that adding Sentry (or anything else) is one function body rather
 * than a sweep through every catch block in the codebase — which is the work
 * that never gets done, and why so many products run for a year with errors
 * going only to a log nobody tails.
 *
 * What it does today is structure the report: a stable fingerprint, the route,
 * the request id, and severity. Those are the fields a vendor needs, so the
 * eventual integration is a mapping rather than a redesign.
 *
 * **It never sends content.** The privacy page states that log lines are
 * written without customer content in them, and an error reporter is the
 * classic way that stops being true — a thrown validation error carries the
 * value that failed, a database error carries the row. `scrub` below is what
 * keeps the statement honest, and it is applied to every report rather than
 * left to the caller to remember.
 */

export type Severity = 'warning' | 'error' | 'fatal';

export interface ErrorReport {
  error: unknown;
  route?: string;
  requestId?: string;
  userId?: string;
  severity?: Severity;
  /** Extra context. Scrubbed before it goes anywhere. */
  context?: Record<string, unknown>;
}

/** Keys whose values are never reported, whatever a caller passes. */
const SENSITIVE_KEYS =
  /(password|secret|token|key|authorization|cookie|session|credential|caption|content|body|prompt|email)/i;

/**
 * Removes anything that might carry customer content or a credential.
 *
 * Deliberately aggressive, and biased toward losing useful debugging detail
 * rather than leaking one caption into a third-party service. A field that is
 * genuinely needed can be renamed to something outside the pattern by whoever
 * needs it — which forces a moment's thought about what is being sent.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    // Long strings are almost always content rather than an identifier.
    return value.length > 200 ? `[string:${value.length}]` : value;
  }

  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.test(key) ? '[redacted]' : scrub(entry, depth + 1);
  }
  return result;
}

/**
 * A stable grouping key.
 *
 * Built from the error's constructor name, the route and the first stack frame
 * inside our own code — NOT from the message, which usually contains an id or
 * a value and would make every occurrence its own unique issue. That is the
 * single most common reason an error tracker becomes unreadable.
 */
export function fingerprint(error: unknown, route?: string): string {
  const name = error instanceof Error ? error.constructor.name : typeof error;

  const frame =
    error instanceof Error && error.stack
      ? (error.stack
          .split('\n')
          .slice(1)
          .find((line) => line.includes('/src/') && !line.includes('node_modules')) ?? '')
          .trim()
          // Strip the absolute path and the line/column, which change between
          // builds and would split one issue into many.
          .replace(/.*\/src\//, 'src/')
          .replace(/:\d+:\d+\)?$/, '')
      : '';

  return [name, route ?? 'unknown', frame].filter(Boolean).join(' | ');
}

/**
 * Reports an error.
 *
 * Today this writes a structured log line. When a vendor is configured, send
 * the same object from here — every caller is already passing the right shape.
 */
export function reportError(report: ErrorReport): void {
  const { error, route, requestId, userId, severity = 'error', context } = report;

  const payload = {
    fingerprint: fingerprint(error, route),
    route,
    requestId,
    // An id, not an email. The scrub pattern would redact `email` anyway; this
    // is the field that is actually useful and actually safe.
    userId,
    severity,
    errorName: error instanceof Error ? error.constructor.name : typeof error,
    context: context ? (scrub(context) as Record<string, unknown>) : undefined,
  };

  if (severity === 'warning') logger.warn('monitoring:report', payload);
  else logger.error('monitoring:report', error, payload);

  /*
   * Where a vendor call goes. Deliberately left as a comment rather than a
   * disabled integration: a half-wired SDK that silently does nothing is worse
   * than an obvious gap, because it looks finished.
   *
   *   if (serverEnv.sentryDsn) Sentry.captureException(error, { ... payload });
   */
}

/** Whether error reporting reaches anywhere beyond the log. */
export function isMonitoringConfigured(): boolean {
  // Honest: nothing is configured, and /api/ready reports it as such rather
  // than implying errors are being collected somewhere.
  return false;
}
