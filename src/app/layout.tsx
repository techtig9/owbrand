import type { Metadata } from 'next';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { Toaster } from 'sonner';
import { ThemeScript } from '@/components/theme/ThemeScript';
import './globals.css';

/**
 * Typography, per spec section 3.
 *
 * Inter is the application face: variable, compact, highly readable at
 * interface sizes, and it ships genuine tabular figures — which the analytics
 * screens need so digits align in a column.
 *
 * Bricolage Grotesque stays as the DISPLAY face, used on marketing surfaces
 * only. The spec asks for expressive marketing type and compact application
 * type, and those are different jobs; using one editorial face for both was
 * what made dashboard headings read as a lifestyle brand rather than a
 * product. The application shell sets `font-body` explicitly.
 *
 * Both are self-hosted by next/font — no render-blocking request to a
 * third-party font host, and no layout shift from a late swap.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700', '800'],
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  // Explicit cuts rather than the variable axis: next/font rejects `axes`
  // alongside `weight`, and the interface only uses four weights.
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'owbrand — Your brand, built and run by AI',
  description:
    'Describe your brand, get a complete identity and website in minutes, then keep it growing with AI-generated photos, posts, logos, and reels — all from one dashboard. Built by Techtig.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The middleware mints a per-request CSP nonce; the theme script needs it or
  // strict-dynamic blocks it and every visitor gets a flash of the wrong theme.
  const nonce = headers().get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body>
        {/*
          Skip link, WCAG 2.2 AA (2.4.1 Bypass Blocks). Visually hidden until
          focused, then it appears — a skip link that stays invisible when
          focused fails the requirement it exists to satisfy.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-fg focus:shadow-lg"
        >
          Skip to main content
        </a>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
