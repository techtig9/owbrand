import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { publicEnv } from '@/lib/env';
import { canonicalUrl } from '@/lib/marketing/site-map';
import { LEGAL_DOCUMENTS, LEGAL_SLUGS } from '@/lib/marketing/legal';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const doc = LEGAL_DOCUMENTS[params.slug];
  if (!doc) return { title: 'Not found — OwBrand' };

  return {
    title: `${doc.title} — OwBrand`,
    description: doc.description,
    alternates: { canonical: canonicalUrl(publicEnv.siteUrl, `/legal/${doc.slug}`) },
    // Drafts must not be indexed as though they were the operative policy.
    // Remove this when a lawyer has signed them off.
    robots: { index: false, follow: true },
  };
}

/**
 * Legal pages, rendered from structured drafts.
 *
 * THE DRAFT NOTICE IS RENDERED HERE, not stored in the content. That is
 * deliberate: a warning that lives in the data can be deleted by editing the
 * data, and the person most likely to do that is someone who wants the page to
 * look finished. Removing it requires changing this component, which is a
 * visible and reviewable act.
 *
 * `robots: { index: false }` for the same reason — an unreviewed privacy policy
 * that ranks is worse than one nobody can find.
 *
 * Each document ends with its own gaps: what it does not cover. That list is
 * the most useful thing a draft can hand the lawyer who reviews it, and it is
 * shown to readers too rather than hidden in a comment, because a reader is
 * entitled to know the policy is incomplete.
 */
export default function LegalPage({ params }: { params: { slug: string } }) {
  const doc = LEGAL_DOCUMENTS[params.slug];
  if (!doc) notFound();

  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <article className="py-16">
          <div className="mx-auto max-w-2xl px-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary hover:text-content"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Home
            </Link>

            <h1 className="mt-8 text-4xl font-bold tracking-tight">{doc.title}</h1>

            {/* Not removable from the content side. See the note above. */}
            <div
              role="note"
              className="mt-6 flex gap-3 rounded-lg border border-warning bg-warning-subtle p-4"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0 text-sm leading-6">
                <p className="font-semibold text-warning">This is a draft awaiting legal review.</p>
                <p className="mt-1 text-content-secondary">
                  It describes what the product actually does, accurately and in good faith, but it has not
                  been reviewed by a lawyer and is not a substitute for one. Do not rely on it as the
                  operative policy.
                </p>
              </div>
            </div>

            <p className="mt-8 text-lg leading-8 text-content">{doc.summary}</p>

            <p className="mt-4 text-xs text-content-tertiary">
              Last reviewed{' '}
              <time dateTime={doc.lastReviewed}>
                {new Date(doc.lastReviewed).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </time>
            </p>

            <div className="mt-10 space-y-10">
              {doc.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="text-xl font-semibold tracking-tight text-content">{section.heading}</h2>

                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="mt-3 text-sm leading-7 text-content-secondary">
                      {paragraph}
                    </p>
                  ))}

                  {section.bullets && (
                    <ul className="mt-4 space-y-2">
                      {section.bullets.map((bullet) => (
                        <li key={bullet} className="flex gap-2.5 text-sm leading-7 text-content-secondary">
                          <span
                            aria-hidden="true"
                            className="mt-3 h-1 w-1 shrink-0 rounded-full bg-content-tertiary"
                          />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>

            <section className="mt-14 rounded-lg border border-[color:var(--color-border-strong)] bg-surface-raised p-6">
              <h2 className="text-base font-semibold text-content">What this draft does not cover</h2>
              <p className="mt-2 text-sm leading-6 text-content-secondary">
                Shown rather than hidden in a comment: a reader is entitled to know where a policy is
                incomplete, and this list is what the reviewing lawyer needs most.
              </p>
              <ul className="mt-4 space-y-2">
                {doc.gaps.map((gap) => (
                  <li key={gap} className="flex gap-2.5 text-sm leading-6 text-content-secondary">
                    <span aria-hidden="true" className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
                    {gap}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
