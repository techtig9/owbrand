import { Mic, ArrowRight, Monitor, Tablet, Smartphone } from 'lucide-react';

export function AIDemo() {
  return (
    <section id="ai-demo" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-xl text-center reveal">
          <span className="section-eyebrow mx-auto">See it work</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">From a sentence to a site.</h2>
          <p className="mt-4 text-ink-soft">
            Type or speak a description. owbrand asks a few quick follow-ups, then builds.
          </p>
        </div>

        <div className="glass-panel reveal mx-auto mt-12 max-w-3xl overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line/70 px-5 py-4">
            <div className="flex flex-1 items-center gap-3 rounded-full border border-line bg-white px-4 py-2.5 text-sm text-ink-soft">
              <span>&ldquo;Build a warm, editorial portfolio site for a ceramics studio&rdquo;</span>
            </div>
            <button type="button" className="rounded-full bg-canvas-alt p-2.5 text-ink-soft" aria-label="Use voice input">
              <Mic className="h-4 w-4" />
            </button>
            <button type="button" className="btn-accent px-4 py-2.5 text-xs">
              Generate <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid gap-0 sm:grid-cols-[auto_1fr]">
            <div className="flex flex-row gap-2 border-b border-line/70 p-4 sm:flex-col sm:border-b-0 sm:border-r">
              {[
                { icon: Monitor, label: 'Desktop', active: true },
                { icon: Tablet, label: 'Tablet', active: false },
                { icon: Smartphone, label: 'Mobile', active: false },
              ].map(({ icon: Icon, label, active }) => (
                <div
                  key={label}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
                    active ? 'bg-ink text-canvas' : 'text-ink-soft'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </div>
              ))}
            </div>

            <div className="bg-canvas-alt p-6">
              <div className="mx-auto max-w-md rounded-xl border border-line bg-white p-5 shadow-soft">
                <div className="mb-4 flex items-center justify-between">
                  <div className="h-3 w-16 rounded-full bg-ink/15" />
                  <div className="flex gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-blush-300" />
                    <div className="h-2 w-2 rounded-full bg-mint-300" />
                    <div className="h-2 w-2 rounded-full bg-lavender-400" />
                  </div>
                </div>
                <div className="mb-3 h-24 rounded-lg bg-blush-50" />
                <div className="mb-2 h-2.5 w-3/4 rounded-full bg-ink/10" />
                <div className="h-2.5 w-1/2 rounded-full bg-ink/10" />
              </div>
              <p className="mt-3 text-center text-xs text-ink-faint">Live preview updates as sections generate</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
