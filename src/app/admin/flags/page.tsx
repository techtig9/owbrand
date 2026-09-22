import { allFlags } from '@/lib/flags';
import { FlagToggles } from '@/components/admin/FlagToggles';

export const dynamic = 'force-dynamic';

/**
 * Feature flags.
 *
 * The screen that lets a feature be turned off during an incident without a
 * deploy — which is the entire reason flags exist, and the moment a deploy is
 * riskiest.
 */
export default async function AdminFlagsPage() {
  const flags = await allFlags();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Feature flags</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-content-secondary">
          Takes effect within 30 seconds, no deploy needed. If the flag table cannot be read, every
          feature falls back to its shipped state rather than switching off — a database blip must
          not hide a working product.
        </p>
      </div>

      <FlagToggles flags={flags} />
    </div>
  );
}
