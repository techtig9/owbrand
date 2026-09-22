import Link from 'next/link';
import { Wand2 } from 'lucide-react';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { EmptyState } from '@/components/dashboard/shared';

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  const supabase = supabaseAdmin();
  const { data: brands } = await supabase
    .from('brands')
    .select('id, name, description, created_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Projects</h1>
          <p className="mt-1 text-sm text-content-secondary">Every brand you&apos;ve generated with owbrand.</p>
        </div>
        <Link href="/dashboard/ai-generator" className="btn-accent">
          <Wand2 className="h-4 w-4" /> New project
        </Link>
      </div>

      {!brands?.length ? (
        <EmptyState
          title="No projects yet"
          body="Generate your first brand and website to see it here."
          action={
            <Link href="/dashboard/ai-generator" className="btn-primary">
              Open AI Generator
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <Link
              key={brand.id}
              href={`/dashboard/brand-kit?brand=${brand.id}`}
              className="rounded-2xl border border-line bg-surface p-5 transition-shadow hover:shadow-soft"
            >
              <div className="h-24 rounded-xl bg-primary-subtle" />
              <h3 className="mt-4 font-display text-base font-semibold text-ink">{brand.name}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-content-secondary">{brand.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
