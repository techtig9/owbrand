'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, MailCheck } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AuthShell, FormField, FormError } from '@/components/auth/AuthShell';
import { toFriendlyAuthError } from '@/lib/auth/auth-errors';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      // Account-enumeration defence: only genuine transport/rate-limit problems
      // are surfaced. An unknown address produces the same confirmation screen
      // as a known one, so this form cannot be used to test whether an email is
      // registered with OwBrand.
      if (resetError) {
        const friendly = toFriendlyAuthError(resetError);
        if (friendly.code === 'rate_limited') {
          setError(friendly.message);
          setLoading(false);
          return;
        }
      }

      setSent(true);
      setLoading(false);
    } catch (err) {
      setError(toFriendlyAuthError(err).message);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <Link href="/login" className="font-semibold text-primary">
          Back to login
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center text-center">
          <span className="rounded-2xl bg-success-subtle p-3">
            <MailCheck className="h-6 w-6 text-success" aria-hidden="true" />
          </span>
          <p className="mt-4 text-sm leading-6 text-content-secondary">
            If an account exists for <strong className="text-ink">{email}</strong>, a password reset link is on its
            way. The link expires in one hour.
          </p>
          <p className="mt-3 text-xs text-content-tertiary">Check your spam folder if it hasn&apos;t arrived shortly.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormError message={error} />
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
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
