'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AuthShell, FormField, FormError } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { toFriendlyAuthError, callbackErrorMessage } from '@/lib/auth/auth-errors';
import { safeRedirectPath } from '@/lib/security/redirect';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The middleware puts the original destination in ?next when it bounces an
  // unauthenticated user. Previously this was written but never read, so every
  // deep link was lost after login.
  const next = safeRedirectPath(searchParams.get('next'));

  // Surface a failure the OAuth callback redirected here with. The code is
  // looked up in a closed map, so nothing attacker-controlled is rendered.
  useEffect(() => {
    const message = callbackErrorMessage(searchParams.get('error'));
    if (message) setError(message);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        setError(toFriendlyAuthError(signInError).message);
        setLoading(false);
        return;
      }

      // Records the sign-in and sends the notification server-side. Never
      // allowed to block the redirect.
      void fetch('/api/auth/session-event', { method: 'POST' }).catch(() => {});

      router.push(next);
      router.refresh();
    } catch (err) {
      setError(toFriendlyAuthError(err).message);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to keep building your brand."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-semibold text-coral-600">
            Sign up
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        <GoogleButton label="Continue with Google" next={next} onError={setError} />

        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-line" />
          <span className="text-xs text-ink-faint">or</span>
          <div className="h-px flex-1 bg-line" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        <div className="text-right">
          <Link href="/forgot-password" className="text-xs font-medium text-ink-soft hover:text-coral-600">
            Forgot password?
          </Link>
        </div>
        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <AuthShell title="Welcome back" subtitle="Log in to keep building your brand." footer={null}>
          <div className="h-48 animate-pulse rounded-xl bg-canvas-alt" />
        </AuthShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
