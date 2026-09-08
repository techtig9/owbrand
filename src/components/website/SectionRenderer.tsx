'use client';

import type { SectionContent } from '@/lib/website/schema';

/**
 * Renders a generated site section.
 *
 * This is what replaces the raw-JSON preview. The master command is explicit
 * that raw JSON must not be the primary editing experience, and until now it
 * was the ONLY experience — `/api/ai/generate-website` returned an object that
 * nothing could display.
 *
 * Deliberately unstyled beyond layout primitives: Phase 5 replaces the design
 * system wholesale, so anything more decorative here would be thrown away. What
 * matters now is that every section type renders something recognisable and
 * editable.
 */

export function SectionRenderer({ content }: { content: SectionContent }) {
  switch (content.kind) {
    case 'hero':
      return (
        <section className="px-8 py-16 text-center">
          {content.eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-content-tertiary">{content.eyebrow}</p>
          )}
          <h1 className="mx-auto mt-3 max-w-3xl font-display text-4xl font-bold leading-tight text-ink">
            {content.headline}
          </h1>
          {content.subheadline && (
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-content-secondary">{content.subheadline}</p>
          )}
          {content.ctas.length > 0 && (
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {content.ctas.map((cta, i) => (
                <span
                  key={i}
                  className={
                    cta.style === 'primary'
                      ? 'rounded-full bg-ink px-6 py-3 text-sm font-semibold text-canvas'
                      : 'rounded-full border border-line px-6 py-3 text-sm font-semibold text-ink'
                  }
                >
                  {cta.label}
                </span>
              ))}
            </div>
          )}
          {content.imagePrompt && <ImagePlaceholder prompt={content.imagePrompt} className="mt-10 h-64" />}
        </section>
      );

    case 'features':
      return (
        <section className="px-8 py-14">
          <SectionHeading heading={content.heading} subheading={content.subheading} />
          <div className="mx-auto mt-8 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {content.items.map((item, i) => (
              <article key={i} className="rounded-2xl border border-line bg-surface p-5">
                <h3 className="font-display text-base font-semibold text-ink">{item.title}</h3>
                {item.description && <p className="mt-2 text-sm leading-6 text-content-secondary">{item.description}</p>}
              </article>
            ))}
          </div>
        </section>
      );

    case 'about':
      return (
        <section className="px-8 py-14">
          <div className="mx-auto max-w-3xl">
            {content.heading && (
              <h2 className="font-display text-2xl font-bold text-ink">{content.heading}</h2>
            )}
            <div className="mt-4 space-y-4 text-sm leading-7 text-content-secondary">
              {content.body.split('\n\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
            {content.imagePrompt && <ImagePlaceholder prompt={content.imagePrompt} className="mt-8 h-56" />}
          </div>
        </section>
      );

    case 'products':
      return (
        <section className="px-8 py-14">
          <SectionHeading heading={content.heading} subheading={content.subheading} />
          <div className="mx-auto mt-8 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {/* Products resolve at render time from the catalogue — the
                generator never hard-codes a product it might have invented. */}
            {(content.productIds.length > 0 ? content.productIds : ['', '', '']).map((id, i) => (
              <div key={i} className="rounded-2xl border border-dashed border-line bg-surface-raised p-5">
                <div className="h-28 rounded-xl bg-surface" />
                <p className="mt-3 text-xs text-content-tertiary">
                  {id ? 'Product from your catalogue' : 'Add products to fill this section'}
                </p>
              </div>
            ))}
          </div>
        </section>
      );

    case 'testimonials':
      // The section exists as a layout slot; it can never carry a generated
      // quote. See lib/website/schema.ts — `placeholder` is z.literal(true).
      return (
        <section className="px-8 py-14">
          <SectionHeading heading={content.heading} />
          <div
            role="note"
            className="mx-auto mt-4 max-w-2xl rounded-xl border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning"
          >
            {content.note}
          </div>
          <div className="mx-auto mt-6 grid max-w-5xl gap-5 sm:grid-cols-3">
            {Array.from({ length: content.slots }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-dashed border-line bg-surface-raised p-5">
                <div className="h-3 w-16 rounded bg-surface" />
                <div className="mt-3 space-y-2">
                  <div className="h-2 rounded bg-surface" />
                  <div className="h-2 w-4/5 rounded bg-surface" />
                </div>
                <p className="mt-4 text-xs text-content-tertiary">Your customer’s words go here</p>
              </div>
            ))}
          </div>
        </section>
      );

    case 'pricing':
      return (
        <section className="px-8 py-14">
          <SectionHeading heading={content.heading} subheading={content.subheading} />
          <div className="mx-auto mt-8 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {content.tiers.map((tier, i) => (
              <article
                key={i}
                className={`rounded-2xl border p-5 ${
                  tier.highlighted ? 'border-ink bg-surface shadow-soft' : 'border-line bg-surface'
                }`}
              >
                <h3 className="font-display text-base font-semibold text-ink">{tier.name}</h3>
                {tier.price && (
                  <p className="mt-2 font-display text-2xl font-bold tabular-nums text-ink">
                    {tier.price}
                    {tier.cadence && <span className="text-sm font-normal text-content-tertiary">/{tier.cadence}</span>}
                  </p>
                )}
                {tier.description && <p className="mt-2 text-xs leading-5 text-content-secondary">{tier.description}</p>}
                {tier.features.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {tier.features.map((feature, j) => (
                      <li key={j} className="text-xs leading-5 text-content-secondary">
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      );

    case 'faq':
      return (
        <section className="px-8 py-14">
          <SectionHeading heading={content.heading} />
          <dl className="mx-auto mt-8 max-w-2xl divide-y divide-line">
            {content.items.map((item, i) => (
              <div key={i} className="py-4">
                <dt className="text-sm font-semibold text-ink">{item.question}</dt>
                <dd className="mt-2 text-sm leading-6 text-content-secondary">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      );

    case 'cta':
      return (
        <section className="px-8 py-16">
          <div className="mx-auto max-w-3xl rounded-3xl bg-ink px-8 py-12 text-center text-canvas">
            <h2 className="font-display text-2xl font-bold">{content.headline}</h2>
            {content.body && <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-canvas/80">{content.body}</p>}
            <span className="mt-6 inline-block rounded-full bg-canvas px-6 py-3 text-sm font-semibold text-ink">
              {content.cta.label}
            </span>
          </div>
        </section>
      );

    case 'contact':
      return (
        <section className="px-8 py-14">
          <div className="mx-auto max-w-xl text-center">
            <SectionHeading heading={content.heading} />
            {content.body && <p className="mt-3 text-sm leading-6 text-content-secondary">{content.body}</p>}
            {content.showForm && (
              <div className="mt-6 space-y-3 text-left">
                {['Name', 'Email', 'Message'].map((label) => (
                  <div key={label}>
                    <span className="mb-1 block text-xs font-medium text-content-secondary">{label}</span>
                    <div className="h-10 rounded-xl border border-line bg-surface" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      );

    case 'gallery':
      return (
        <section className="px-8 py-14">
          <SectionHeading heading={content.heading} />
          <div className="mx-auto mt-8 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(content.imagePrompts.length > 0 ? content.imagePrompts : ['', '', '']).map((prompt, i) => (
              <ImagePlaceholder key={i} prompt={prompt} className="h-40" />
            ))}
          </div>
        </section>
      );

    case 'footer':
      return (
        <footer className="border-t border-line px-8 py-10">
          <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:justify-between">
            {content.tagline && <p className="text-sm text-content-secondary">{content.tagline}</p>}
            <div className="flex flex-wrap gap-8">
              {content.columns.map((column, i) => (
                <div key={i}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">{column.heading}</p>
                  <ul className="mt-2 space-y-1">
                    {column.links.map((link, j) => (
                      <li key={j} className="text-xs text-content-secondary">
                        {link.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </footer>
      );

    default: {
      // Exhaustiveness guard: adding a section kind without a renderer becomes
      // a compile error rather than a blank space in the preview.
      const exhaustive: never = content;
      return <UnknownSection value={exhaustive} />;
    }
  }
}

function SectionHeading({ heading, subheading }: { heading?: string; subheading?: string }) {
  if (!heading && !subheading) return null;
  return (
    <div className="mx-auto max-w-2xl text-center">
      {heading && <h2 className="font-display text-2xl font-bold text-ink">{heading}</h2>}
      {subheading && <p className="mt-2 text-sm leading-6 text-content-secondary">{subheading}</p>}
    </div>
  );
}

/**
 * Stands in for imagery the generator described but has not produced.
 *
 * Shows the prompt so the user knows what would be generated — much more
 * useful than a grey box, and it makes the "generate this image" action
 * obvious.
 */
function ImagePlaceholder({ prompt, className = '' }: { prompt: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-2xl border border-dashed border-line bg-surface-raised p-4 ${className}`}
    >
      <p className="max-w-xs text-center text-xs leading-5 text-content-tertiary">
        {prompt ? `Image: ${prompt}` : 'Image placeholder'}
      </p>
    </div>
  );
}

function UnknownSection({ value }: { value: unknown }) {
  return (
    <section className="px-8 py-8">
      <div className="rounded-xl border border-dashed border-line bg-surface-raised p-4 text-xs text-content-tertiary">
        This section type has no preview yet ({String((value as { kind?: string })?.kind ?? 'unknown')}).
      </div>
    </section>
  );
}
