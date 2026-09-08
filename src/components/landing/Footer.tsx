import Link from 'next/link';
import { Mail, Phone } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-line bg-canvas py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <Link href="/" className="font-display text-lg font-bold text-ink">
            owbrand
          </Link>
          <p className="mt-1 text-xs text-content-tertiary">Developed by Techtig</p>
        </div>

        <div className="flex flex-col gap-2 text-sm text-content-secondary sm:items-end">
          <a href="mailto:techtig9@gmail.com" className="flex items-center gap-2 hover:text-primary">
            <Mail className="h-3.5 w-3.5" /> techtig9@gmail.com
          </a>
          <a href="tel:+923488597892" className="flex items-center gap-2 hover:text-primary">
            <Phone className="h-3.5 w-3.5" /> +92 348 8597892
          </a>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-content-tertiary">
        © {new Date().getFullYear()} owbrand, a Techtig product. All rights reserved.
      </p>
    </footer>
  );
}
