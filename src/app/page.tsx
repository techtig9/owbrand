import type { Metadata } from 'next';
import { publicEnv } from '@/lib/env';
import { canonicalUrl } from '@/lib/marketing/site-map';
import { StructuredData } from '@/components/marketing/StructuredData';
import { Navbar } from '@/components/landing/Navbar';
import { Hero } from '@/components/landing/Hero';
import { TrustedBy } from '@/components/landing/TrustedBy';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Features } from '@/components/landing/Features';
import { AIDemo } from '@/components/landing/AIDemo';
import { Templates } from '@/components/landing/Templates';
import { Differentiation } from '@/components/landing/Differentiation';
import { Pricing } from '@/components/landing/Pricing';
import { FAQ } from '@/components/landing/FAQ';
import { Help } from '@/components/landing/Help';
import { About } from '@/components/landing/About';
import { Footer } from '@/components/landing/Footer';

/**
 * Page-level metadata, overriding the layout's defaults.
 *
 * The canonical URL is explicit. Without it, the same content is reachable at
 * `/`, `/?utm_source=…` and every other query string a campaign appends, and a
 * crawler treats them as separate pages competing with each other.
 */
export const metadata: Metadata = {
  title: 'OwBrand — describe your brand once, generate everything from it',
  description:
    'Build a reusable Brand Brain from one business description, then generate on-brand websites, posts and creative from it. Claims you have not approved are blocked, and unmeasured metrics are reported as absent rather than as zero.',
  alternates: { canonical: canonicalUrl(publicEnv.siteUrl, '/') },
  openGraph: {
    type: 'website',
    siteName: 'OwBrand',
    url: canonicalUrl(publicEnv.siteUrl, '/'),
    title: 'OwBrand — describe your brand once, generate everything from it',
    description:
      'A brand operating system. Everything downstream is generated from one stored Brand Brain rather than from a fresh prompt each time.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OwBrand — describe your brand once, generate everything from it',
    description:
      'A brand operating system. Everything downstream is generated from one stored Brand Brain rather than from a fresh prompt each time.',
  },
};

export default function LandingPage() {
  return (
    <>
      <StructuredData siteUrl={publicEnv.siteUrl} />
      <Navbar />
      <main id="main-content">
        <Hero />
        <TrustedBy />
        {/* Before capabilities: the rest of the page described what the product
            can do without ever saying what a visitor does first. */}
        <HowItWorks />
        <Features />
        <AIDemo />
        <Templates />
        {/* Immediately before pricing, which is where the "why this one"
            question actually gets asked. */}
        <Differentiation />
        <Pricing />
        <FAQ />
        <Help />
        <About />
      </main>
      <Footer />
    </>
  );
}
