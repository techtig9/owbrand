import Link from 'next/link';

const links = [
  { href: '#features', label: 'Features' },
  { href: '#templates', label: 'Templates' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-canvas/80 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-1.5 font-display text-xl font-bold tracking-tight text-ink">
          owbrand
          <span className="text-primary" aria-hidden="true">✦</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="text-sm font-medium text-content-secondary transition-colors hover:text-ink">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden text-sm font-semibold text-ink hover:text-primary sm:inline-block">
            Login
          </Link>
          <Link href="/signup" className="btn-accent">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
