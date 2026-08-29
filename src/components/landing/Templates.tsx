const CATEGORIES = [
  'Business', 'Restaurant', 'Hotel', 'Gym', 'School', 'Hospital',
  'Real Estate', 'Law Firm', 'Beauty Salon', 'Construction', 'Travel', 'Portfolio',
  'Blog', 'Landing Page', 'SaaS', 'E-commerce', 'Agency', 'Startup', 'Education', 'Healthcare',
];

const SWATCHES = ['bg-blush-100', 'bg-mint-100', 'bg-lavender-200', 'bg-canvas-alt'];

export function Templates() {
  return (
    <section id="templates" className="border-t border-line bg-canvas-alt py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 reveal">
          <div>
            <span className="section-eyebrow">Templates & themes</span>
            <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Start further ahead.</h2>
          </div>
          <p className="max-w-sm text-sm text-ink-soft">
            300+ templates across 20 categories, all restyled by owbrand&apos;s AI to fit your brand.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {CATEGORIES.map((category, i) => (
            <div key={category} className="glass-panel reveal group cursor-pointer overflow-hidden p-3">
              <div className={`h-24 rounded-lg ${SWATCHES[i % SWATCHES.length]} transition-transform duration-300 group-hover:scale-105`} />
              <p className="mt-3 text-sm font-medium text-ink">{category}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
