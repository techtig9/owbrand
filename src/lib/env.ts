/**
 * Single, validated entry point for every environment variable OwBrand reads.
 *
 * Design rules:
 *  - Access is LAZY. Nothing throws at import time, so `next build` succeeds
 *    without production secrets and a missing credential surfaces as a clear
 *    runtime error on the one route that needs it, not as a build failure.
 *  - Server-only values are guarded: reading one from a browser bundle throws
 *    rather than silently returning undefined.
 *  - Optional integrations expose an `isConfigured` check so we can report
 *    honestly (`/api/ready`) instead of claiming a provider is available when
 *    its credentials are absent.
 */

class MissingEnvError extends Error {
  constructor(name: string, hint?: string) {
    super(`Missing required environment variable ${name}.${hint ? ` ${hint}` : ''}`);
    this.name = 'MissingEnvError';
  }
}

function assertServer(name: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(`${name} is server-only and must never be read in browser code.`);
  }
}

function required(name: string, value: string | undefined, hint?: string): string {
  if (!value || value.trim() === '') throw new MissingEnvError(name, hint);
  return value;
}

function optional(value: string | undefined): string | undefined {
  return value && value.trim() !== '' ? value : undefined;
}

/* ------------------------------------------------------------------ *
 * Public (browser-safe) configuration
 * ------------------------------------------------------------------ */

export const publicEnv = {
  get supabaseUrl(): string {
    // Inlined by Next at build time; referenced statically so it survives bundling.
    return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey(): string {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  get siteUrl(): string {
    return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000';
  },
  get paddleClientToken(): string | undefined {
    return optional(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN);
  },
  get paddleEnvironment(): 'production' | 'sandbox' {
    return process.env.NEXT_PUBLIC_PADDLE_ENV === 'production' ? 'production' : 'sandbox';
  },
};

/* ------------------------------------------------------------------ *
 * Server-only configuration
 * ------------------------------------------------------------------ */

export const serverEnv = {
  get supabaseServiceRoleKey(): string {
    assertServer('SUPABASE_SERVICE_ROLE_KEY');
    return required(
      'SUPABASE_SERVICE_ROLE_KEY',
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Copy it from Supabase → Project Settings → API.'
    );
  },

  /* --- Email (Resend) --- */
  get resendApiKey(): string {
    assertServer('RESEND_API_KEY');
    return required('RESEND_API_KEY', process.env.RESEND_API_KEY, 'Create one at resend.com/api-keys.');
  },
  get emailFrom(): string {
    return process.env.EMAIL_FROM || 'OwBrand <noreply@owbrand.ai>';
  },
  get emailReplyTo(): string | undefined {
    return optional(process.env.EMAIL_REPLY_TO);
  },
  /** Master switch — when false no transactional notification is attempted at all. */
  get emailNotificationsEnabled(): boolean {
    return flag(process.env.EMAIL_NOTIFICATIONS_ENABLED, true);
  },
  get notifyOnSignup(): boolean {
    return flag(process.env.EMAIL_NOTIFY_SIGNUP, true);
  },
  get notifyOnSignin(): boolean {
    // Off by default: a mail on every login is noisy, and the master command
    // explicitly warns against sending excessive email.
    return flag(process.env.EMAIL_NOTIFY_SIGNIN, false);
  },

  /* --- Billing (Paddle) --- */
  get paddleApiKey(): string {
    assertServer('PADDLE_API_KEY');
    return required('PADDLE_API_KEY', process.env.PADDLE_API_KEY);
  },
  get paddleWebhookSecret(): string {
    assertServer('PADDLE_WEBHOOK_SECRET');
    return required('PADDLE_WEBHOOK_SECRET', process.env.PADDLE_WEBHOOK_SECRET);
  },

  /* --- Rate limiting (Upstash Redis) --- */
  get upstashUrl(): string | undefined {
    return optional(process.env.UPSTASH_REDIS_REST_URL);
  },
  get upstashToken(): string | undefined {
    return optional(process.env.UPSTASH_REDIS_REST_TOKEN);
  },

  get appVersion(): string {
    return process.env.APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'development';
  },
};

function flag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/* ------------------------------------------------------------------ *
 * Honest capability reporting
 * ------------------------------------------------------------------ */

/**
 * Whether an optional integration has the credentials it needs. Used by
 * /api/ready and by the integrations UI so we never claim a provider is live
 * when it is not configured.
 */
export const isConfigured = {
  supabase: () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseAdmin: () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  email: () => Boolean(process.env.RESEND_API_KEY),
  billing: () => Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_WEBHOOK_SECRET),
  rateLimitStore: () => Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  ai: () => Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY),
  imageProvider: () => Boolean(process.env.IMAGE_PROVIDER_URL && process.env.IMAGE_PROVIDER_API_KEY),
  videoProvider: () => Boolean(process.env.VIDEO_PROVIDER_URL && process.env.VIDEO_PROVIDER_API_KEY),
};

export { MissingEnvError };
