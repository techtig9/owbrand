import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/subscriptions', label: 'Subscriptions' },
  { href: '/admin/payments', label: 'Payments' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/dashboard');

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-ink">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/admin" className="font-display text-lg font-bold text-canvas">
              owbrand <span className="text-primary">admin</span>
            </Link>
            <nav className="flex gap-6">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="text-sm font-medium text-canvas/70 hover:text-canvas">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <Link href="/dashboard" className="text-xs font-medium text-canvas/70 hover:text-canvas">
            ← Back to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
