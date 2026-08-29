import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canUseFeature, refundCredits } from '@/lib/credits';
import { generateWithGemini } from '@/lib/gemini';
import { buildReelScriptPrompt } from '@/lib/prompts/content';

const bodySchema = z.object({
  brandId: z.string().uuid(),
  instruction: z.string().min(1).max(1000),
  assetIds: z.array(z.string().uuid()).min(1).max(12),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', details: parsed.error.flatten() }, { status: 400 });
  }
  const { brandId, instruction, assetIds } = parsed.data;

  const gate = await canUseFeature(user, 'generate_reel');
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason, upgradeRequired: true }, { status: 402 });
  }

  const supabase = supabaseAdmin();

  try {
    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .select('name, description, brand_colors, brand_fonts')
      .eq('id', brandId)
      .eq('user_id', user.id)
      .single();
    if (brandError || !brand) throw new Error('Brand not found.');

    const { data: assets, error: assetsError } = await supabase
      .from('content_assets')
      .select('url, caption')
      .in('id', assetIds)
      .eq('user_id', user.id);
    if (assetsError || !assets?.length) throw new Error('Source assets not found.');

    const { systemPrompt, userPrompt } = buildReelScriptPrompt(
      { name: brand.name, description: brand.description, colors: brand.brand_colors, fonts: brand.brand_fonts },
      assets.map((a) => ({ url: a.url ?? '', caption: a.caption })),
      instruction
    );

    const raw = await generateWithGemini({ task: 'reel_script', systemPrompt, userPrompt, jsonSchema: true });
    const script = JSON.parse(raw);

    // The script is handed to the compositing layer (Remotion/ffmpeg.wasm), which
    // is NOT an AI call — it just renders the scenes Gemini planned. That render
    // job is queued separately; this route only returns the plan + a draft asset row.
    const { data: asset, error: insertError } = await supabase
      .from('content_assets')
      .insert({ user_id: user.id, brand_id: brandId, type: 'reel', url: null, caption: null, status: 'draft' })
      .select()
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ asset, script, creditsRemaining: gate.creditsRemainingAfter });
  } catch (err) {
    await refundCredits(user.id, gate.creditCost);
    console.error('generate-reel failed', err);
    return NextResponse.json({ error: 'Reel scripting failed. You have not been charged — please try again.' }, { status: 502 });
  }
}
