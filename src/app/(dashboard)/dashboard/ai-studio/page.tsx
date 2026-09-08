import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accessibleBrandIds } from '@/lib/auth/guards';
import { isConfigured } from '@/lib/env';
import { CreativeStudio } from '@/components/creative/CreativeStudio';
import { EmptyState } from '@/components/dashboard/shared';

export const dynamic = 'force-dynamic';

/**
 * Creative Studio.
 *
 * Brands are resolved server-side from the caller's accessible set rather than
 * fetched by the client from `/api/brands` — the client can only ever offer a
 * brand the server already confirmed.
 *
 * Provider capability is also resolved here. `isConfigured` reads server-only
 * env vars, so this is the only place that can answer "can this server
 * actually generate an image" without leaking the credentials themselves.
 */
export default async function AIStudioPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = supabaseAdmin();
  const accessible = await accessibleBrandIds(user.id, db);

  if (accessible.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Header />
        <EmptyState
          title="No brand yet"
          body="The studio writes in your brand's voice, so it needs a Brand Brain first."
          action={
            <Link href="/dashboard/ai-generator" className="btn-primary">
              Build my brand
            </Link>
          }
        />
      </div>
    );
  }

  const { data: brands } = await db
    .from('brands')
    .select('id, name')
    .in('id', accessible)
    .order('created_at', { ascending: false });

  const options = (brands ?? []).map((brand: { id: string; name: string }) => ({
    id: brand.id,
    name: brand.name,
  }));

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <Header />
      <CreativeStudio
        brands={options}
        initialBrandId={options[0]?.id ?? accessible[0]}
        capabilities={{
          ai: isConfigured.ai(),
          image: isConfigured.imageProvider(),
          video: isConfigured.videoProvider(),
        }}
      />
    </div>
  );
}

function Header() {
  return (
    <div>
      <p className="section-eyebrow">Creative engine</p>
      <h1 className="mt-3 font-display text-3xl font-bold">Creative Studio</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Copy, reel scripts, product photography and short-form video — each generated against your Brand Brain and
        your approved product facts.
      </p>
    </div>
  );
}
