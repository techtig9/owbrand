/**
 * Rate limiting.
 *
 * The previous implementation was an in-memory Map that nothing imported. Two
 * problems: it was dead code, and even wired up it would have been useless on
 * serverless, where each invocation may get a fresh process — an attacker just
 * needs their requests to land on different instances.
 *
 * This version uses Upstash Redis (sliding window, shared across instances)
 * when UPSTASH_REDIS_REST_URL/TOKEN are set, and falls back to a per-process
 * limiter otherwise. The fallback is honest about what it is: it protects a
 * single-instance deployment and local development, and `isDistributed` reports
 * which mode is active so /api/ready can flag the weaker one in production.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { serverEnv } from '@/lib/env';
import { ApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Named policies. Auth and billing are deliberately strict; read endpoints are
 * loose enough not to interfere with normal dashboard use.
 */
export const RATE_LIMITS = {
  /** Login, signup, password reset — credential stuffing / enumeration defence. */
  auth: { limit: 10, windowSeconds: 60 },
  /** OAuth callback — generous, a user may legitimately retry. */
  authCallback: { limit: 20, windowSeconds: 60 },
  /** AI generation — expensive, and already credit-gated. */
  aiGeneration: { limit: 20, windowSeconds: 60 },
  /** Media upload URL minting. */
  upload: { limit: 30, windowSeconds: 60 },
  /** Publishing and scheduling. */
  publish: { limit: 30, windowSeconds: 60 },
  /** Billing mutations. */
  billing: { limit: 15, windowSeconds: 60 },
  /** Inbound provider webhooks — high, they are signature-verified anyway. */
  webhook: { limit: 300, windowSeconds: 60 },
  /** Ordinary authenticated reads and writes. */
  standard: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/* ------------------------------------------------------------------ *
 * Upstash-backed limiter (preferred)
 * ------------------------------------------------------------------ */

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url = serverEnv.upstashUrl;
  const token = serverEnv.upstashToken;
  if (!url || !token) {
    redis = null;
    return null;
  }

  try {
    redis = new Redis({ url, token });
  } catch (error) {
    logger.error('rate_limit:redis_init_failed', error);
    redis = null;
  }
  return redis;
}

const limiterCache = new Map<string, Ratelimit>();

function getLimiter(name: RateLimitName, rule: RateLimitRule): Ratelimit | null {
  const client = getRedis();
  if (!client) return null;

  const cached = limiterCache.get(name);
  if (cached) return cached;

  const limiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSeconds} s`),
    prefix: `owbrand:rl:${name}`,
    analytics: false,
  });
  limiterCache.set(name, limiter);
  return limiter;
}

/* ------------------------------------------------------------------ *
 * In-process fallback
 * ------------------------------------------------------------------ */

const buckets = new Map<string, { count: number; resetAt: number }>();

function memoryLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();

  // Opportunistic sweep so the map cannot grow without bound.
  if (buckets.size > 10_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return { allowed: true, limit: rule.limit, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= rule.limit;
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** True when limits are enforced across every instance rather than per-process. */
export function isDistributed(): boolean {
  return getRedis() !== null;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Checks a rate limit without throwing.
 * `identifier` should be the most specific stable subject available: a user id
 * for authenticated routes, otherwise the client IP.
 */
export async function checkRateLimit(name: RateLimitName, identifier: string): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[name];
  const key = `${name}:${identifier}`;

  const limiter = getLimiter(name, rule);
  if (!limiter) return memoryLimit(key, rule);

  try {
    const result = await limiter.limit(identifier);
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: result.remaining,
      retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  } catch (error) {
    // Redis unreachable: fail closed onto the in-process limiter rather than
    // letting every request through unchecked.
    logger.warn('rate_limit:redis_unavailable_using_memory', { name, error: String(error) });
    return memoryLimit(key, rule);
  }
}

/** Checks a rate limit and raises ApiError(429) when exceeded. */
export async function enforceRateLimit(name: RateLimitName, identifier: string): Promise<void> {
  const result = await checkRateLimit(name, identifier);
  if (!result.allowed) {
    logger.warn('rate_limit:exceeded', { name, identifier: hashIdentifier(identifier) });
    throw ApiError.rateLimited(result.retryAfterSeconds);
  }
}

/**
 * Best-effort client IP from proxy headers. Vercel sets x-forwarded-for; the
 * left-most entry is the original client.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Never log a raw IP or user id against a rate-limit event. */
function hashIdentifier(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = (hash << 5) - hash + identifier.charCodeAt(i);
    hash |= 0;
  }
  return `id_${Math.abs(hash).toString(36)}`;
}

/** Test-only: clears the in-process buckets between cases. */
export function __resetMemoryBuckets(): void {
  buckets.clear();
}
