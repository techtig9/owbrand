import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canUseFeature } from '@/lib/credits';

const bodySchema = z.object({
  contentAssetId: z.string().uuid(),
  platform: z.enum(['facebook', 'instagram']),
  scheduledAt: z.string().datetime(),
});

/** Free action (0 credits) — it reuses an already-generated asset — but still plan-gated. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const { contentAssetId, platform, scheduledAt } = parsed.data;

  const gate = await canUseFeature(user, 'schedule_post');
  if (!gate.allowed) return NextResponse.json({ error: gate.reason, upgradeRequired: true }, { status: 402 });

  const supabase = supabaseAdmin();

  const { data: account } = await supabase
    .from('social_accounts')
    .select('id')
    .eq('user_id', user.id)
    .eq('platform', platform)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: `Connect a ${platform} account first.` }, { status: 400 });
  }

  const { data: post, error } = await supabase
    .from('scheduled_posts')
    .insert({ user_id: user.id, content_asset_id: contentAssetId, platform, scheduled_at: scheduledAt, status: 'queued' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Actual publish happens in a background worker/cron job (see spec's Scheduling
  // layer note — Supabase scheduled functions or BullMQ) that polls `queued` rows
  // where scheduled_at <= now() and calls the Meta Graph API. Not implemented here.
  return NextResponse.json({ post });
}
