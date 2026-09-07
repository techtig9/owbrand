'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, Home } from 'lucide-react';

/**
 * Route-level error boundary.
 *
 * The repository previously had none, so any thrown error rendered Next's raw
 * default. `error.digest` is the server-side correlation id — it is safe to
 * show and lets support find the matching structured log line. The message
 * itself is deliberately not rendered: in production it could carry internals.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[owbrand] route error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="section-eyebrow mx-auto">Something went wrong</p>
        <h1 className="mt-5 font-display text-3xl font-bold text-ink">We hit an unexpected error</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          This has been logged and we&apos;re looking into it. Try again — most of the time it clears straight away.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset} className="btn-primary">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
          <Link href="/dashboard" className="btn-ghost">
            <Home className="h-4 w-4" aria-hidden="true" />
            Back to dashboard
          </Link>
        </div>

        {error.digest && (
          <p className="mt-8 text-xs text-ink-faint">
            Reference: <code className="font-mono">{error.digest}</code>
          </p>
        )}
      </div>
    </main>
  );
}
