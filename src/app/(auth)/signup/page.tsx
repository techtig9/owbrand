'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MailCheck } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AuthShell, FormField, FormError } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { toFriendlyAuthError } from '@/lib/auth/auth-errors';
import { safeRedirectPath } from '@/lib/security/redirect';

/** Minimum viable password policy, checked before the request is sent. */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Include at least one letter and one number.';
  }
  if (/^(password|12345678|qwerty)/i.test(password)) return 'That password is too easy to guess.';
  return null;
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRedirectPath(searchParams.get('next'));

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const problem = passwordProblem(password);
    setPasswordError(problem);
    if (problem) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const callback = new URL('/auth/callback', window.location.origin);
      if (next !== '/dashboard') callback.searchParams.set('next', next);

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name.trim() },
          emailRedirectTo: callback.toString(),
        },
      });

      if (signUpError) {
        setError(toFriendlyAuthError(signUpError).message);
        setLoading(false);
        return;
      }

      // When email confirmation is disabled Supabase returns a live session, so
      // the user is already logged in and should go straight to the app.
      if (data.session) {
        void fetch('/api/auth/session-event', { method: 'POST' }).catch(() => {});
        router.push(next);
        router.refresh();
        return;
      }

      // Otherwise a verification mail is on its way. The welcome notification
      // is sent server-side once they complete the callback.
      setSent(true);
      setLoading(false);
    } catch (err) {
      setError(toFriendlyAuthError(err).message);
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle="One quick step and your account is live."
        footer={
          <>
            Wrong address?{' '}
            <button type="button" onClick={() => setSent(false)} className="font-semibold text-primary">
              Go back
            </button>
          </>
        }
      >
        <div className="flex flex-col items-center text-center">
          <span className="rounded-2xl bg-success-subtle p-3">
            <MailCheck className="h-6 w-6 text-success" aria-hidden="true" />
          </span>
          <p className="mt-4 text-sm leading-6 text-content-secondary">
            We sent a verification link to <strong className="text-ink">{email}</strong>. Click it to activate your
            account, then you&apos;ll be signed straight in.
          </p>
          <p className="mt-3 text-xs text-content-tertiary">
            Nothing after a minute? Check your spam folder before trying again.
          </p>
          <Link href="/login" className="btn-primary mt-6 w-full">
            Back to login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start with 500 free credits — no card required."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-primary">
            Log in
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        <GoogleButton label="Sign up with Google" next={next} onError={setError} />

        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-line" />
          <span className="text-xs text-content-tertiary">or</span>
          <div className="h-px flex-1 bg-line" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
        <FormField
          label="Name"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
        />
        <FormField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@brand.com"
        />
        <FormField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (passwordError) setPasswordError(passwordProblem(e.target.value));
          }}
          placeholder="At least 8 characters"
          hint="At least 8 characters, including a letter and a number."
          error={passwordError ?? undefined}
        />
        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <AuthShell title="Create your account" subtitle="Start with 500 free credits." footer={null}>
          <div className="h-56 animate-pulse rounded-xl bg-surface-raised" />
        </AuthShell>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
