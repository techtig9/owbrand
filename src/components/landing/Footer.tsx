import Link from 'next/link';
import { Mail } from 'lucide-react';
import { PUBLIC_ROUTES } from '@/lib/marketing/site-map';

/**
 * The site footer.
 *
 * Link groups are written out rather than generated from `PUBLIC_ROUTES`,
 * because a footer needs human labels and an order that makes sense to a
 * reader — but the legal group is CHECKED against that list at module scope,
 * so a legal page added to the sitemap and forgotten here fails the build
 * rather than becoming an orphan only a crawler ever finds.
 *
 * The phone number was removed. A published mobile number on a marketing
 * footer collects automated calls and cannot be rotated the way an address
 * can; if a phone line is wanted it should be a business line, not someone's
 * personal mobile.
 */

const PRODUCT_LINKS = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#how-we-differ', label: 'How we differ' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
];

const COMPANY_LINKS = [
  { href: '/changelog', label: 'Changelog' },
  { href: '/blog', label: 'Blog' },
];

const LEGAL_LINKS = [
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/refund', label: 'Refunds' },
  { href: '/legal/ai-use', label: 'How we use AI' },
  { href: '/legal/subprocessors', label: 'Subprocessors' },
];

/*
 * Build-time consistency check.
 *
 * Every /legal/* route advertised in the sitemap must appear in the footer.
 * Without this, adding a legal page to PUBLIC_ROUTES and forgetting the footer
 * produces a page that is indexed but unreachable by a human — which for a
 * privacy policy is a compliance problem, not a navigation one.
 */
const advertisedLegal = PUBLIC_ROUTES.filter((route) => route.path.startsWith('/legal/')).map((r) => r.path);
const linkedLegal = new Set(LEGAL_LINKS.map((link) => link.href));
const missingFromFooter = advertisedLegal.filter((path) => !linkedLegal.has(path));

if (missingFromFooter.length > 0) {
  throw new Error(
    `Footer is missing legal links present in the sitemap: ${missingFromFooter.join(', ')}. ` +
      'A legal page that is indexed but unreachable by a human is a compliance problem.'
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[color:var(--color-border)] bg-surface-raised py-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link href="/" className="text-lg font-bold text-content">
              owbrand
            </Link>
            <p className="mt-2 max-w-xs text-xs leading-5 text-content-tertiary">
              A brand operating system. Developed by Techtig.
            </p>
            <a
              href="mailto:techtig9@gmail.com"
              className="mt-4 inline-flex items-center gap-2 text-sm text-content-secondary hover:text-primary"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              techtig9@gmail.com
            </a>
          </div>

          <FooterGroup title="Product" links={PRODUCT_LINKS} />
          <FooterGroup title="Company" links={COMPANY_LINKS} />
          <FooterGroup title="Legal" links={LEGAL_LINKS} />
        </div>

        <p className="mt-12 border-t border-[color:var(--color-border)] pt-6 text-xs text-content-tertiary">
          © {new Date().getFullYear()} owbrand, a Techtig product.
        </p>
      </div>
    </footer>
  );
}

function FooterGroup({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">{title}</h2>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-sm text-content-secondary hover:text-primary">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
