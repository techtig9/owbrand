import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: 403 });

  const supabase = supabaseAdmin();
  const { data, error: dbError } = await supabase
    .from('subscriptions')
    .select('id, user_id, plan, status, credits_remaining, renews_at, users(email, name)')
    .order('renews_at', { ascending: true });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ subscriptions: data });
}
