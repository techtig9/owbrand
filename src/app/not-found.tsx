import Link from 'next/link';
import { Home, LifeBuoy } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="section-eyebrow mx-auto">404</p>
        <h1 className="mt-5 font-display text-3xl font-bold text-ink">We can&apos;t find that page</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          The link may be out of date, or the page may have moved.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className="btn-primary">
            <Home className="h-4 w-4" aria-hidden="true" />
            Go to homepage
          </Link>
          <Link href="/dashboard" className="btn-ghost">
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            Open dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
