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
 * A single post.
 *
 * `generateStaticParams` returns published slugs only, so a draft is not
 * pre-rendered — and `readContent` refuses drafts at request time too. Two
 * independent checks, because the build-time one alone would still serve a
 * draft on demand.
 */
export async function generateStaticParams() {
  const posts = await listContent('blog');
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await readContent('blog', params.slug);
  if (!post) return { title: 'Not found — OwBrand' };

  return {
    title: `${post.title} — OwBrand`,
    description: post.description,
    alternates: { canonical: canonicalUrl(publicEnv.siteUrl, `/blog/${post.slug}`) },
    openGraph: { type: 'article', title: post.title, description: post.description },
  };
}

export default async function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = await readContent('blog', params.slug);
  if (!post) notFound();

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <article className="py-20">
          <div className="mx-auto max-w-2xl px-6">
            <Link
              href="/blog"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All posts
            </Link>

            <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-content-tertiary">
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

            <h1 className="mt-3 text-4xl font-bold tracking-tight">{post.title}</h1>
            <p className="mt-4 text-lg leading-8 text-content-secondary">{post.description}</p>

            {/*
              `prose-owbrand` is defined in globals.css against the design
              tokens rather than using a typography plugin, so post copy is
              themed by the same variables as the rest of the app and follows
              the dark theme without a second set of overrides.
            */}
            <div className="prose-owbrand mt-10">
              <MDXRemote source={post.body} />
            </div>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
