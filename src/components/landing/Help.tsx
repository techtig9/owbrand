import { FileText, MonitorSmartphone, History, Rocket } from 'lucide-react';

const HOW_IT_WORKS = [
  'You describe the website you want — by typing or speaking — including its name and purpose.',
  "owbrand's AI asks a few quick follow-up questions (website type, theme, color preference, style) with selectable options, so you're picking rather than typing everything out.",
  'The AI generates a complete, responsive website — Navbar, Hero, About, Services, Features, Footer, and any extra sections your description implies — built with React and Tailwind CSS.',
  'You review it instantly in the live preview, on desktop, tablet, or mobile.',
];

const HOW_TO_USE = [
  'Sign up (or log in with Google) and go to AI Generator in your dashboard.',
  "Enter your website's name and a description of what it's for.",
  "Answer the AI's short follow-up questions (or skip and let it choose sensible defaults).",
  'Click Generate Website and watch your site build in the live preview.',
  'Fine-tune it in the built-in code editor if you want to adjust anything directly.',
  'Export the code (ZIP, React, or Next.js project) or deploy straight to Vercel or Netlify — all from one screen.',
];

const WHAT_IT_PROVIDES = [
  {
    icon: FileText,
    title: 'A complete, ready-to-deploy website',
    body: 'Generated from a plain-language description — no coding required, but full code access if you want it.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Live preview & code editor',
    body: 'Live preview across devices, a Monaco-powered code editor, version history, and one-click deployment.',
  },
  {
    icon: History,
    title: 'A library of ready-made templates',
    body: 'Themes and templates across categories like Business, Portfolio, Restaurant, Travel, Education, Agency, Startup, Healthcare, and Real Estate.',
  },
];

function NumberedList({ items }: { items: string[] }) {
  return (
    <ol className="space-y-4">
      {items.map((item, i) => (
        <li key={item} className="flex gap-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink font-display text-xs font-bold text-canvas">
            {i + 1}
          </span>
          <p className="pt-0.5 text-sm leading-relaxed text-ink-soft">{item}</p>
        </li>
      ))}
    </ol>
  );
}

export function Help() {
  return (
    <section id="help" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-xl reveal">
          <span className="section-eyebrow">Help</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">How owbrand works.</h2>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <div className="glass-panel reveal p-7">
            <h3 className="font-display text-xl font-semibold text-ink">How it works</h3>
            <div className="mt-6">
              <NumberedList items={HOW_IT_WORKS} />
            </div>
          </div>

          <div className="glass-panel reveal p-7">
            <h3 className="font-display text-xl font-semibold text-ink">How to use it</h3>
            <div className="mt-6">
              <NumberedList items={HOW_TO_USE} />
            </div>
          </div>
        </div>

        <div className="mt-10 reveal">
          <h3 className="font-display text-xl font-semibold text-ink">What it provides</h3>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {WHAT_IT_PROVIDES.map((item) => (
              <div key={item.title} className="rounded-2xl border border-line bg-white p-6">
                <item.icon className="h-5 w-5 text-coral-500" strokeWidth={1.75} />
                <h4 className="mt-4 font-display text-sm font-semibold text-ink">{item.title}</h4>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex items-center gap-3 rounded-2xl border border-line bg-canvas-alt p-5 reveal">
          <Rocket className="h-5 w-5 shrink-0 text-coral-500" />
          <p className="text-sm text-ink-soft">
            Still have questions? Reach the Techtig team any time — see contact details in the footer.
          </p>
        </div>
      </div>
    </section>
  );
}
