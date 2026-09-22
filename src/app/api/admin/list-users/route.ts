import { NextResponse } from 'next/server';
import { routeHandler } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/require-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

/* Wrapped so a missing Supabase configuration is a 503, not a raw 500. */
export const GET = routeHandler('/api/admin/list-users', async (request: Request) => {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: 403 });

  const search = new URL(request.url).searchParams.get('q')?.trim();
  const supabase = supabaseAdmin();

  let query = supabase
    .from('users')
    .select('id, name, email, role, created_at, subscriptions(plan, credits_remaining, status)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (search) query = query.ilike('email', `%${search}%`);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ users: data });
});
