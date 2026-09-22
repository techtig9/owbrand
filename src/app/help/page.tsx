import type { Metadata } from 'next';
import Link from 'next/link';
import { LifeBuoy, ArrowRight } from 'lucide-react';
import { publicEnv } from '@/lib/env';
import { canonicalUrl } from '@/lib/marketing/site-map';
import { listContent, type ContentMeta } from '@/lib/content/mdx';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Help — OwBrand',
  description: 'How publishing, credits, brand consistency and connections actually work.',
  alternates: { canonical: canonicalUrl(publicEnv.siteUrl, '/help') },
};

/**
 * The help centre.
 *
 * Written around what people get stuck on rather than around the product's
 * feature list — the first article is "why a post did not publish", because
 * that is the question that produces support tickets, not "an overview of the
 * scheduler".
 *
 * Grouped by category and ordered within it, both from front matter, so the
 * order is an editorial decision in the article rather than an accident of
 * filename or date.
 */
export default async function HelpPage() {
  const articles = await listContent('help');

  const byCategory = articles.reduce<Record<string, ContentMeta[]>>((groups, article) => {
    const key = article.category || 'Other';
    (groups[key] ??= []).push(article);
    return groups;
  }, {});

  for (const list of Object.values(byCategory)) {
    list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="border-b border-[color:var(--color-border)] py-20">
          <div className="mx-auto max-w-3xl px-6">
            <span className="section-eyebrow">Help</span>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              How things actually work
            </h1>
            <p className="mt-5 text-base leading-7 text-content-secondary">
              Written around what people get stuck on, not around a feature list. Each article says
              what the product does, what it does not, and why.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-3xl px-6 py-16">
          {articles.length === 0 ? (
            <Card className="p-8">
              <div className="flex items-start gap-3">
                <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0 text-content-tertiary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-content">No articles yet</p>
                  <p className="mt-1 text-sm leading-6 text-content-secondary">
                    In the meantime,{' '}
                    <Link href="/contact" className="text-primary underline underline-offset-2">
                      send us a question
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <div className="space-y-12">
              {Object.entries(byCategory).map(([category, list]) => (
                <section key={category}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">
                    {category}
                  </h2>
                  <ul className="mt-4 space-y-3">
                    {list.map((article) => (
                      <li key={article.slug}>
                        <Link
                          href={`/help/${article.slug}`}
                          className="flex items-start gap-4 rounded-xl border border-[color:var(--color-border)] p-5 transition-colors duration-micro hover:bg-surface-raised"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-base font-semibold text-content">
                              {article.title}
                            </span>
                            <span className="mt-1 block text-sm leading-6 text-content-secondary">
                              {article.description}
                            </span>
                          </span>
                          <ArrowRight
                            className="mt-1 h-4 w-4 shrink-0 text-content-tertiary"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <Card className="mt-14 p-6">
            <h2 className="text-base font-semibold text-content">Not covered here?</h2>
            <p className="mt-1 text-sm leading-6 text-content-secondary">
              Ask us directly. Questions that come up more than once end up on this page.
            </p>
            <Link
              href="/contact"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-2"
            >
              Contact us
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Card>
        </div>
      </main>
      <Footer />
    </>
  );
}
