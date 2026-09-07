/**
 * Maps Supabase Auth errors to messages we are willing to show a user.
 *
 * Two goals:
 *  1. Be genuinely helpful — "Invalid login credentials" is Supabase's wording
 *     for both a wrong password and an unknown email; ours explains what to do.
 *  2. Never leak account existence. Signup and password-reset responses must
 *     look identical whether or not the address is registered, otherwise the
 *     forms become an account-enumeration oracle.
 */

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'user_already_exists'
  | 'weak_password'
  | 'rate_limited'
  | 'oauth_failed'
  | 'session_expired'
  | 'provider_not_configured'
  | 'unknown';

export interface FriendlyAuthError {
  code: AuthErrorCode;
  message: string;
}

interface SupabaseLikeError {
  message?: string;
  code?: string;
  status?: number;
}

export function toFriendlyAuthError(error: unknown): FriendlyAuthError {
  const err = (error ?? {}) as SupabaseLikeError;
  const raw = (err.message ?? '').toLowerCase();
  const code = (err.code ?? '').toLowerCase();

  if (raw.includes('invalid login credentials') || code === 'invalid_credentials') {
    return {
      code: 'invalid_credentials',
      message: 'That email and password combination did not match. Check them and try again.',
    };
  }

  if (raw.includes('email not confirmed') || code === 'email_not_confirmed') {
    return {
      code: 'email_not_confirmed',
      message: 'Please confirm your email first — check your inbox for the verification link.',
    };
  }

  if (raw.includes('already registered') || raw.includes('already exists') || code === 'user_already_exists') {
    return {
      code: 'user_already_exists',
      message: 'That email is already registered. Try logging in instead.',
    };
  }

  if (raw.includes('password') && (raw.includes('weak') || raw.includes('at least') || raw.includes('short'))) {
    return {
      code: 'weak_password',
      message: 'Choose a stronger password — at least 8 characters, and not a common one.',
    };
  }

  if (err.status === 429 || raw.includes('rate limit') || raw.includes('too many')) {
    return {
      code: 'rate_limited',
      message: 'Too many attempts. Please wait a minute and try again.',
    };
  }

  if (raw.includes('provider is not enabled') || raw.includes('unsupported provider')) {
    return {
      code: 'provider_not_configured',
      message: 'Google sign-in is not available right now. Please use your email and password.',
    };
  }

  if (raw.includes('session') && (raw.includes('expired') || raw.includes('missing'))) {
    return {
      code: 'session_expired',
      message: 'That link has expired. Please request a new one.',
    };
  }

  return {
    code: 'unknown',
    message: 'Something went wrong. Please try again.',
  };
}

/**
 * Messages for the `?error=` codes the OAuth callback can redirect with.
 * Kept as a closed set so the callback can never reflect attacker-controlled
 * text back into the login page.
 */
export const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: 'Google sign-in did not complete. Please try again.',
  oauth_denied: 'Google sign-in was cancelled.',
  exchange_failed: 'We could not finish signing you in. Please try again.',
  missing_code: 'That sign-in link was incomplete. Please try again.',
  link_expired: 'That link has expired. Please request a new one.',
  provider_error: 'Your sign-in provider reported a problem. Please try again.',
};

export function callbackErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return CALLBACK_ERROR_MESSAGES[code] ?? CALLBACK_ERROR_MESSAGES.oauth_failed;
}
