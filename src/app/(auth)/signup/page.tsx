'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AuthShell, FormField } from '@/components/auth/AuthShell';
import { GoogleButton } from '@/components/auth/GoogleButton';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Check your inbox" subtitle="We've sent a verification link to confirm your email." footer={null}>
        <p className="text-sm text-ink-soft">
          Click the link in the email from owbrand to activate your account, then log in. Didn&apos;t get it? Check
          spam, or try signing up again in a minute.
        </p>
        <Link href="/login" className="btn-primary mt-6 w-full">
          Back to login
        </Link>
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
          <Link href="/login" className="font-semibold text-coral-600">
            Log in
          </Link>
        </>
      }
    >
      <div className="space-y-3">
        <GoogleButton label="Sign up with Google" />
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-line" />
          <span className="text-xs text-ink-faint">or</span>
          <div className="h-px flex-1 bg-line" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        <FormField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com" />
        <FormField
          label="Password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}
