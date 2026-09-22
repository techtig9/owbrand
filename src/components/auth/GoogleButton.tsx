'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { toFriendlyAuthError } from '@/lib/auth/auth-errors';
import { safeRedirectPath } from '@/lib/security/redirect';

/**
 * Google sign-in.
 *
 * Fixed in Phase 1: the previous version discarded the result of
 * signInWithOAuth entirely, so a misconfigured provider produced a button that
 * visibly did nothing. It now has loading, disabled and error states, reports
 * failures to the user, and passes a validated `next` through to the callback.
 */
export function GoogleButton({
  label,
  next,
  onError,
}: {
  label: string;
  next?: string | null;
  onError?: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const callback = new URL('/auth/callback', window.location.origin);
      const destination = safeRedirectPath(next ?? null);
      if (destination !== '/dashboard') callback.searchParams.set('next', destination);

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callback.toString(),
          queryParams: { prompt: 'select_account' },
        },
      });

      if (oauthError) {
        const friendly = toFriendlyAuthError(oauthError);
        setError(friendly.message);
        onError?.(friendly.message);
        setLoading(false);
        return;
      }

      // Supabase normally performs the redirect itself. If it returned a URL
      // without navigating, follow it rather than leaving the user stuck.
      if (data?.url) {
        window.location.assign(data.url);
        return;
      }

      // No error and no URL: nothing will happen, so say so instead of
      // spinning forever.
      setError('Google sign-in is unavailable right now. Please use your email and password.');
      onError?.('Google sign-in is unavailable right now. Please use your email and password.');
      setLoading(false);
    } catch (err) {
      const friendly = toFriendlyAuthError(err);
      setError(friendly.message);
      onError?.(friendly.message);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-busy={loading}
        className="btn-ghost w-full disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4c-7.6 0-14.2 4.3-17.7 10.7z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.4C29.6 35.4 26.9 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.6 5.1C9.7 39.6 16.3 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.6l6.6 5.4C41.4 36.2 44 30.6 44 24c0-1.3-.1-2.7-.4-3.5z"
            />
          </svg>
        )}
        {loading ? 'Redirecting to Google…' : label}
      </button>

      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
