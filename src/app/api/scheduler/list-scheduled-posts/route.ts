import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Reads the session cookie, so it can never be statically prerendered.
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, platform, scheduled_at, status, content_assets(type, url, caption)')
    .eq('user_id', user.id)
    .order('scheduled_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ scheduledPosts: data });
}
