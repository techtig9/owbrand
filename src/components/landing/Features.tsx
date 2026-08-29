import { Wand2, Palette, Camera, CalendarClock, Mic, Code2 } from 'lucide-react';

const FEATURES = [
  {
    icon: Wand2,
    title: 'AI website generation',
    body: 'Describe your business in plain language — owbrand builds a complete, responsive site with React and Tailwind CSS.',
  },
  {
    icon: Palette,
    title: 'AI UI/UX designer',
    body: 'Layouts, color schemes, typography, icons, and animations chosen to fit your brand, not a generic template.',
  },
  {
    icon: Camera,
    title: 'AI Content Studio',
    body: 'Keep generating on-brand photos, social posts, logo variations, and captions long after launch day.',
  },
  {
    icon: CalendarClock,
    title: 'Auto-post scheduler',
    body: 'Queue generated posts and reels to publish automatically to your connected Facebook and Instagram accounts.',
  },
  {
    icon: Mic,
    title: 'Voice input',
    body: 'Describe your brand or a content request by speaking — transcribed and understood instantly.',
  },
  {
    icon: Code2,
    title: 'Full code access',
    body: 'A built-in Monaco editor and one-click export to ZIP, React, or Next.js whenever you want to go hands-on.',
  },
];

export function Features() {
  return (
    <section id="features" className="border-t border-line bg-canvas-alt py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-xl reveal">
          <span className="section-eyebrow">What owbrand does</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            One dashboard to build the brand, then run it.
          </h2>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass-panel reveal p-6">
              <f.icon className="h-6 w-6 text-coral-500" strokeWidth={1.75} />
              <h3 className="mt-4 font-display text-lg font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
