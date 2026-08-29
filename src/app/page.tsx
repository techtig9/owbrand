import { Navbar } from '@/components/landing/Navbar';
import { Hero } from '@/components/landing/Hero';
import { TrustedBy } from '@/components/landing/TrustedBy';
import { Features } from '@/components/landing/Features';
import { AIDemo } from '@/components/landing/AIDemo';
import { Templates } from '@/components/landing/Templates';
import { Pricing } from '@/components/landing/Pricing';
import { FAQ } from '@/components/landing/FAQ';
import { Help } from '@/components/landing/Help';
import { About } from '@/components/landing/About';
import { Footer } from '@/components/landing/Footer';

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <TrustedBy />
        <Features />
        <AIDemo />
        <Templates />
        <Pricing />
        <FAQ />
        <Help />
        <About />
      </main>
      <Footer />
    </>
  );
}
