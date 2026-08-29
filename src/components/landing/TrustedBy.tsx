// A "trusted by" strip in the spirit of the reference agency-template pattern:
// a quiet, neutral logo row directly under the hero. We deliberately show the
// real infrastructure owbrand runs on (Supabase, Google Gemini, Paddle, Resend)
// rather than inventing customer names/logos — per
// OWBRAND_MASTER_CLAUDE_BUILD_PROMPT §61/§44 (never present fabricated
// companies, stats or trust signals as real). Swap in real customer logos here
// once owbrand has publishable customers.
const PARTNERS = [
  'Supabase',
  'Google Gemini',
  'Paddle',
  'Resend',
  'Next.js',
];

export function TrustedBy() {
  return (
    <div className="reveal border-y border-line/70 bg-canvas-alt/60 py-8">
      <div className="mx-auto max-w-6xl px-6">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Built on infrastructure you already trust
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {PARTNERS.map((name) => (
            <span
              key={name}
              className="trust-logo font-display text-lg font-bold tracking-tight text-ink"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
