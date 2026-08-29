import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';

const bodySchema = z.object({
  platform: z.enum(['facebook', 'instagram']),
  // Short-lived code from the Meta OAuth redirect — exchanged for a long-lived
  // token server-side. The actual OAuth dance (redirect to Meta, callback here)
  // is standard Meta Graph API login; wire up META_APP_ID/META_APP_SECRET.
  oauthCode: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const { platform, oauthCode } = parsed.data;

  const supabase = supabaseAdmin();

  if (user.role !== 'admin') {
    const { data: subscription } = await supabase.from('subscriptions').select('plan').eq('user_id', user.id).maybeSingle();
    const plan: PlanId = (subscription?.plan as PlanId) ?? 'free';
    const limit = PLANS[plan].limits.connectedSocialAccounts;

    if (limit === 0) {
      return NextResponse.json({ error: 'Connecting social accounts requires a paid plan.', upgradeRequired: true }, { status: 402 });
    }
    if (limit !== -1) {
      const { count } = await supabase
        .from('social_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if ((count ?? 0) >= limit) {
        return NextResponse.json(
          { error: `Your plan allows ${limit} connected account(s). Upgrade to connect more.`, upgradeRequired: true },
          { status: 402 }
        );
      }
    }
  }

  // TODO: exchange oauthCode with Meta's /oauth/access_token endpoint using
  // META_APP_ID/META_APP_SECRET, then store the resulting long-lived token.
  const exchangedAccessToken = `placeholder_token_for_${oauthCode.slice(0, 8)}`;

  const { data: account, error } = await supabase
    .from('social_accounts')
    .upsert({ user_id: user.id, platform, access_token: exchangedAccessToken }, { onConflict: 'user_id,platform' })
    .select('id, platform, connected_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account });
}
