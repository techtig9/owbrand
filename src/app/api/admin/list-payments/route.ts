import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: 403 });

  const supabase = supabaseAdmin();
  const { data, error: dbError } = await supabase
    .from('payments')
    .select('id, paddle_transaction_id, amount, status, created_at, users(email, name)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ payments: data });
}
