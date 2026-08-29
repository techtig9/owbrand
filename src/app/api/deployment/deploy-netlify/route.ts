import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canUseFeature } from '@/lib/credits';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';

const bodySchema = z.object({ brandId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const { brandId } = parsed.data;

  const gate = await canUseFeature(user, 'deploy');
  if (!gate.allowed) return NextResponse.json({ error: gate.reason, upgradeRequired: true }, { status: 402 });

  if (user.role !== 'admin') {
    const supabase = supabaseAdmin();
    const { data: subscription } = await supabase.from('subscriptions').select('plan').eq('user_id', user.id).maybeSingle();
    const plan: PlanId = (subscription?.plan as PlanId) ?? 'free';
    if (!PLANS[plan].features.deployNetlify) {
      return NextResponse.json({ error: 'Deploying to Netlify requires a paid plan.', upgradeRequired: true }, { status: 402 });
    }
  }

  const supabase = supabaseAdmin();
  const { data: deployment, error } = await supabase
    .from('deployments')
    .insert({ project_id: brandId, provider: 'netlify', status: 'pending' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // TODO: call the Netlify API (POST /api/v1/sites/{site_id}/deploys) with
  // NETLIFY_API_TOKEN, then poll for status the same way as deploy-vercel.

  return NextResponse.json({ deployment });
}
