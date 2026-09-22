import Link from 'next/link';
import { publicEnv } from '@/lib/env';

/**
 * The free-plan attribution badge.
 *
 * Shown on outputs a free-plan account shares or publishes — never inside the
 * app itself, where it would be advertising to someone already signed in.
 *
 * Deliberately a real link with visible text rather than a logo image: it has
 * to survive being copied into a page whose CSS we do not control, and an
 * image that fails to load leaves nothing at all. `rel="noopener"` because any
 * link that ends up on a customer's own site should not hand the opener a
 * window reference.
 *
 * Paid plans render nothing. `plan` is required rather than defaulting,
 * because a default of "show the badge" would put it on paid output and a
 * default of "hide" would quietly drop it from free output — both wrong in a
 * way nobody notices until a customer complains.
 */
export function MadeWithBadge({ plan }: { plan: string }) {
  if (plan !== 'free') return null;

  return (
    <div className="flex justify-center py-4">
      <Link
        href={publicEnv.siteUrl}
        rel="noopener"
        target="_blank"
        className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-surface px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-micro hover:border-[color:var(--color-border-strong)] hover:text-content"
      >
        <span
          aria-hidden="true"
          className="grid h-4 w-4 place-items-center rounded-sm bg-primary text-[10px] font-bold text-primary-fg"
        >
          o
        </span>
        Made with owbrand
      </Link>
    </div>
  );
}
