import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FileText } from 'lucide-react';
import { publicEnv } from '@/lib/env';
import { canonicalUrl } from '@/lib/marketing/site-map';
import { listContent } from '@/lib/content/mdx';
import { Card, EmptyState } from '@/components/ui';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Blog — OwBrand',
  description: 'Notes on brand state, honest analytics, and what the product cannot do yet.',
  alternates: { canonical: canonicalUrl(publicEnv.siteUrl, '/blog') },
};

/**
 * The blog index.
 *
 * Drafts are excluded — `listContent` defaults to that, and the default is the
 * point: the alternative is a half-finished post shipping because one of two
 * listing pages forgot a filter.
 *
 * Every post in `content/blog/` is currently `draft: true`, so this page
 * legitimately renders its empty state. That is not a bug to paper over with a
 * placeholder card: three unfinished drafts pretending to be articles would be
 * exactly the fabrication the rest of this codebase refuses.
 */
export default async function BlogIndexPage() {
  const posts = await listContent('blog');

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="border-b border-[color:var(--color-border)] py-20">
          <div className="mx-auto max-w-3xl px-6">
            <span className="section-eyebrow">Blog</span>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              How this is built, and what it will not do.
            </h1>
            <p className="mt-5 text-base leading-7 text-content-secondary">
              Engineering notes rather than announcements.
            </p>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            {posts.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="No posts published yet"
                body="Drafts exist in content/blog/ and are excluded from this list until their front matter sets draft: false."
                action={
                  <Link href="/" className="btn-ghost">
                    Back to the product
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-4">
                {posts.map((post) => (
                  <li key={post.slug}>
                    <Card as="article" interactive className="p-6">
                      <Link href={`/blog/${post.slug}`} className="block">
                        <div className="flex flex-wrap items-center gap-3 text-xs text-content-tertiary">
                          {post.date && (
                            <time dateTime={post.date}>
                              {new Date(post.date).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                              })}
                            </time>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>{post.readingMinutes} min read</span>
                        </div>

                        <h2 className="mt-2 text-xl font-semibold text-content">{post.title}</h2>
                        <p className="mt-2 text-sm leading-6 text-content-secondary">{post.description}</p>

                        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                          Read
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
