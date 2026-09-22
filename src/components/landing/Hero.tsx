import Link from 'next/link';
import { Sparkles, Mic } from 'lucide-react';
import { BrandKitMarquee } from './BrandKitMarquee';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-aurora-soft">
      <div className="mx-auto grid max-w-6xl items-center gap-16 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
        <div className="reveal">
          <span className="section-eyebrow">
            <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
            AI Brand Builder & Manager
          </span>

          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Build a brand
            <br />
            from <span className="text-primary">one idea.</span>
          </h1>

          <p className="mt-6 max-w-lg text-lg leading-relaxed text-content-secondary">
            Upload your product. OwBrand creates the brand, content, campaigns and marketing
            system — describe it by typing or speaking, and keep generating on-brand photos,
            posts, logos, and reels from one dashboard.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link href="/signup" className="btn-accent">
              Create your brand <span aria-hidden="true">✦</span>
            </Link>
            <Link href="/signup" className="btn-ghost">
              <Mic className="h-4 w-4" /> Try it by voice
            </Link>
          </div>

          <div className="mt-10 flex items-center gap-6 text-xs font-medium uppercase tracking-wide text-content-tertiary">
            <span>500 free credits</span>
            <span className="h-1 w-1 rounded-full bg-ink-faint" />
            <span>No card required</span>
            <span className="h-1 w-1 rounded-full bg-ink-faint" />
            <span>Built by Techtig</span>
          </div>
        </div>

        <BrandKitMarquee />
      </div>
    </section>
  );
}
