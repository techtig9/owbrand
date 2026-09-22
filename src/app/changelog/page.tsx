import type { Metadata } from 'next';
import { publicEnv } from '@/lib/env';
import { canonicalUrl } from '@/lib/marketing/site-map';
import { CHANGELOG, type ChangeKind } from '@/lib/marketing/changelog';
import { Badge } from '@/components/ui';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Changelog — OwBrand',
  description: 'What changed, when, including the things that were wrong.',
  alternates: { canonical: canonicalUrl(publicEnv.siteUrl, '/changelog') },
};

/**
 * The public changelog.
 *
 * Two things it does that most do not:
 *
 *  - **It lists fixes and security changes, not only additions.** A changelog
 *    of features reads as marketing; one that says "this was wrong and here is
 *    what it was" is the only version worth a reader's trust. The entries for
 *    the FAQ describing features that do not exist, and for a broken skip
 *    link, are the whole point.
 *  - **Each entry describes what changed for a user**, not what was committed.
 *    "Refactored the credit ledger" is not a changelog entry; "you are no
 *    longer charged for a generation that failed" is.
 */

const TONE: Record<ChangeKind, 'success' | 'warning' | 'info' | 'danger'> = {
  added: 'success',
  fixed: 'warning',
  changed: 'info',
  security: 'danger',
};

const LABEL: Record<ChangeKind, string> = {
  added: 'Added',
  fixed: 'Fixed',
  changed: 'Changed',
  security: 'Security',
};

export default function ChangelogPage() {
  return (
    <>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="border-b border-[color:var(--color-border)] py-20">
          <div className="mx-auto max-w-3xl px-6">
            <span className="section-eyebrow">Changelog</span>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">What changed, and when.</h1>
            <p className="mt-5 text-base leading-7 text-content-secondary">
              Including the things that were wrong. A changelog of only new features is a press release.
            </p>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-6">
            <ol className="space-y-12">
              {CHANGELOG.map((release) => (
                <li key={release.date}>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h2 className="text-lg font-semibold text-content">
                      <time dateTime={release.date}>
                        {new Date(release.date).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </time>
                    </h2>
                    {release.version && (
                      <span className="text-xs text-content-tertiary">{release.version}</span>
                    )}
                  </div>

                  <ul className="mt-5 space-y-4">
                    {release.changes.map((change) => (
                      <li key={change.text} className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                        {/* The kind is a labelled badge, so the category is
                            readable without interpreting a colour. */}
                        <span className="shrink-0 sm:w-20">
                          <Badge tone={TONE[change.kind]}>{LABEL[change.kind]}</Badge>
                        </span>
                        <p className="min-w-0 flex-1 text-sm leading-6 text-content-secondary">
                          {change.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
