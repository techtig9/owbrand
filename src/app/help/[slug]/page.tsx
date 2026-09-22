import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { publicEnv } from '@/lib/env';
import { canonicalUrl } from '@/lib/marketing/site-map';
import { listContent, readContent } from '@/lib/content/mdx';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

/**
 * A help article.
 *
 * Same two independent draft guards as the blog: `generateStaticParams`
 * returns published slugs only, and `readContent` refuses drafts at request
 * time as well. The build-time check alone would still serve a draft on
 * demand.
 */
export async function generateStaticParams() {
  const articles = await listContent('help');
  return articles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const article = await readContent('help', params.slug);
  if (!article) return { title: 'Not found — OwBrand' };

  return {
    title: `${article.title} — OwBrand help`,
    description: article.description,
    alternates: { canonical: canonicalUrl(publicEnv.siteUrl, `/help/${article.slug}`) },
  };
}

export default async function HelpArticlePage({ params }: { params: { slug: string } }) {
  const article = await readContent('help', params.slug);
  if (!article) notFound();

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <article className="py-20">
          <div className="mx-auto max-w-2xl px-6">
            <Link
              href="/help"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All help articles
            </Link>

            <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-content-tertiary">
              {article.category && <span>{article.category}</span>}
              <span aria-hidden="true">·</span>
              <span>{article.readingMinutes} min read</span>
            </div>

            <h1 className="mt-3 text-4xl font-bold tracking-tight">{article.title}</h1>
            <p className="mt-4 text-lg leading-8 text-content-secondary">{article.description}</p>

            <div className="prose-owbrand mt-10">
              <MDXRemote source={article.body} />
            </div>

            <div className="mt-14 rounded-xl border border-[color:var(--color-border)] p-5">
              <p className="text-sm leading-6 text-content-secondary">
                Did this answer the question?{' '}
                <Link href="/contact" className="text-primary underline underline-offset-2">
                  Tell us if not
                </Link>{' '}
                — articles get rewritten when they do not.
              </p>
            </div>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
