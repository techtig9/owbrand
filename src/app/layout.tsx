import type { Metadata } from 'next';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

// Display face: Bricolage Grotesque — a bold, slightly quirky editorial grotesk
// that reads "fashion/lifestyle brand," not a generic SaaS sans.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700', '800'],
});

// Body face: Inter — light/regular grotesk for readable long-form copy.
const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'owbrand — Your brand, built and run by AI',
  description:
    'Describe your brand, get a complete identity and website in minutes, then keep it growing with AI-generated photos, posts, logos, and reels — all from one dashboard. Built by Techtig.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
