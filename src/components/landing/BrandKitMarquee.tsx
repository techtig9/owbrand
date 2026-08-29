const CARDS = [
  {
    kind: 'logo',
    tilt: '-3deg',
    label: 'Logo kit',
    accent: 'bg-blush-100',
  },
  {
    kind: 'post',
    tilt: '2deg',
    label: 'Instagram post',
    accent: 'bg-mint-100',
  },
  {
    kind: 'reel',
    tilt: '-2deg',
    label: 'Reel · 0:18',
    accent: 'bg-lavender-200',
  },
  {
    kind: 'logo',
    tilt: '3deg',
    label: 'Logo kit',
    accent: 'bg-mint-100',
  },
] as const;

function LogoCard({ accent }: { accent: string }) {
  return (
    <div className={`flex h-full flex-col items-center justify-center gap-3 rounded-xl ${accent} p-6`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 font-display text-2xl font-bold text-ink shadow-soft">
        Ow
      </div>
      <div className="h-2 w-16 rounded-full bg-white/70" />
    </div>
  );
}

function PostCard({ accent }: { accent: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl">
      <div className={`flex-1 ${accent}`} />
      <div className="space-y-1.5 bg-white p-3">
        <div className="h-2 w-3/4 rounded-full bg-ink/10" />
        <div className="h-2 w-1/2 rounded-full bg-ink/10" />
      </div>
    </div>
  );
}

function ReelCard({ accent }: { accent: string }) {
  return (
    <div className={`relative flex h-full flex-col justify-end rounded-xl ${accent} p-3`}>
      <div className="absolute right-3 top-3 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-ink">
        ● REC
      </div>
      <div className="space-y-1.5 rounded-lg bg-white/70 p-2 backdrop-blur">
        <div className="h-1.5 w-2/3 rounded-full bg-ink/15" />
        <div className="h-1.5 w-1/3 rounded-full bg-ink/15" />
      </div>
    </div>
  );
}

function MockCard({ kind, tilt, label, accent }: (typeof CARDS)[number]) {
  const inner = kind === 'logo' ? <LogoCard accent={accent} /> : kind === 'post' ? <PostCard accent={accent} /> : <ReelCard accent={accent} />;
  return (
    <div
      className="glass-panel mx-3 h-56 w-40 shrink-0 animate-float p-2"
      style={{ ['--tilt' as string]: tilt }}
    >
      <div className="h-full w-full overflow-hidden rounded-xl">{inner}</div>
      <p className="mt-2 px-1 text-[11px] font-medium text-ink-soft">{label}</p>
    </div>
  );
}

/**
 * The signature element: a slow, seamless horizontal scroll of the exact kind
 * of output owbrand produces (logo kit, social post, reel) shown in realistic
 * device/post frames — a direct, tangible answer to "what does this actually make?"
 */
export function BrandKitMarquee() {
  const track = [...CARDS, ...CARDS];
  return (
    <div className="reveal relative -mr-6 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div className="flex w-max animate-marquee py-4">
        {track.map((card, i) => (
          <MockCard key={i} {...card} />
        ))}
      </div>
    </div>
  );
}
