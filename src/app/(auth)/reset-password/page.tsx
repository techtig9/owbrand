'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ShieldCheck } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AuthShell, FormField, FormError } from '@/components/auth/AuthShell';
import { toFriendlyAuthError } from '@/lib/auth/auth-errors';

function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Include at least one letter and one number.';
  }
  return null;
}

type RecoveryState = 'checking' | 'ready' | 'invalid';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState>('checking');

  // A recovery link establishes a short-lived session. Previously this page
  // rendered the form unconditionally, so arriving without a valid link gave a
  // form that always failed on submit with a raw provider error.
  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setRecovery(data.session ? 'ready' : 'invalid');
      })
      .catch(() => {
        if (!cancelled) setRecovery('invalid');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const problem = passwordProblem(password) ?? (password !== confirm ? 'Both passwords must match.' : null);
    setFieldError(problem);
    if (problem) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(toFriendlyAuthError(updateError).message);
        setLoading(false);
        return;
      }

      // Force a fresh login with the new credentials rather than silently
      // continuing on the recovery session.
      await supabase.auth.signOut();
      router.push('/login?reset=1');
    } catch (err) {
      setError(toFriendlyAuthError(err).message);
      setLoading(false);
    }
  }

  if (recovery === 'checking') {
    return (
      <AuthShell title="Set a new password" subtitle="Checking your reset link…" footer={null}>
        <div className="h-32 animate-pulse rounded-xl bg-canvas-alt" />
      </AuthShell>
    );
  }

  if (recovery === 'invalid') {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Reset links are valid for one hour."
        footer={
          <Link href="/login" className="font-semibold text-coral-600">
            Back to login
          </Link>
        }
      >
        <p className="text-sm leading-6 text-ink-soft">
          Request a new link and we&apos;ll email it straight over.
        </p>
        <Link href="/forgot-password" className="btn-primary mt-6 w-full">
          Send a new reset link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a new password for your account." footer={null}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormError message={error} />

        <FormField
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldError) setFieldError(null);
          }}
          placeholder="At least 8 characters"
          hint="At least 8 characters, including a letter and a number."
        />
        <FormField
          label="Confirm new password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            if (fieldError) setFieldError(null);
          }}
          placeholder="Re-enter your new password"
          error={fieldError ?? undefined}
        />

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          )}
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}
