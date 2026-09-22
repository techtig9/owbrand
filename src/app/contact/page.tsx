import type { Metadata } from 'next';
import { Mail } from 'lucide-react';
import { publicEnv, isConfigured } from '@/lib/env';
import { isDistributed } from '@/lib/security/rate-limit';
import { canonicalUrl } from '@/lib/marketing/site-map';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { ContactForm } from '@/components/marketing/ContactForm';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contact — OwBrand',
  description: 'Ask a question about OwBrand. A real person reads these.',
  alternates: { canonical: canonicalUrl(publicEnv.siteUrl, '/contact') },
};

/**
 * The contact page.
 *
 * The form is only rendered when the server can actually deliver a message.
 * Otherwise it shows a mailto fallback — a contact form that silently drops
 * messages is the single worst thing on a marketing site, because the sender
 * believes they have been heard and waits.
 */
export default function ContactPage() {
  const deliverable = isConfigured.email() && isDistributed();

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="border-b border-[color:var(--color-border)] py-20">
          <div className="mx-auto max-w-2xl px-6">
            <span className="section-eyebrow">Contact</span>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Ask us anything</h1>
            <p className="mt-5 text-base leading-7 text-content-secondary">
              Before you write: the{' '}
              <a href="/help" className="text-primary underline underline-offset-2">
                help centre
              </a>{' '}
              covers publishing failures, credits, and what the consistency check does — which is
              most of what people ask.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-2xl px-6 py-16">
          {deliverable ? (
            <ContactForm />
          ) : (
            <Card className="p-8">
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-content-tertiary" aria-hidden="true" />
                <div>
                  <h2 className="text-base font-semibold text-content">Email us directly</h2>
                  <p className="mt-1 text-sm leading-6 text-content-secondary">
                    The form is not available on this deployment, so rather than showing one that
                    would quietly drop your message, here is the address.
                  </p>
                  <a
                    href="mailto:techtig9@gmail.com"
                    className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-2"
                  >
                    techtig9@gmail.com
                  </a>
                </div>
              </div>
            </Card>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
