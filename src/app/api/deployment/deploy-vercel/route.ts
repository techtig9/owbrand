import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canUseFeature } from '@/lib/credits';
import { PLANS } from '@/lib/plans';
import type { PlanId } from '@/types';

const bodySchema = z.object({ brandId: z.string().uuid() });

/** Deploy is free (0 credits) but Free-plan users can't deploy at all. */
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
    if (!PLANS[plan].features.deployVercel) {
      return NextResponse.json({ error: 'Deploying to Vercel requires a paid plan.', upgradeRequired: true }, { status: 402 });
    }
  }

  const supabase = supabaseAdmin();
  const { data: deployment, error } = await supabase
    .from('deployments')
    .insert({ project_id: brandId, provider: 'vercel', status: 'pending' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // TODO: call the Vercel REST API (POST /v13/deployments) with VERCEL_API_TOKEN,
  // passing the exported project files, then poll for status and update this row
  // (building → live/failed) plus set deployment_url once Vercel assigns one.

  return NextResponse.json({ deployment });
}
