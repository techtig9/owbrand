import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canUseFeature, refundCredits } from '@/lib/credits';
import { generateWithGemini } from '@/lib/gemini';
import { buildContentAssetPrompt } from '@/lib/prompts/content';
import type { FeatureAction } from '@/types';

const bodySchema = z.object({
  brandId: z.string().uuid(),
  type: z.enum(['photo', 'post', 'logo', 'content']),
  instruction: z.string().min(1).max(1000),
  platform: z.string().optional(),
});

const ACTION_BY_TYPE: Record<string, FeatureAction> = {
  photo: 'generate_photo',
  post: 'generate_post',
  logo: 'generate_logo',
  content: 'generate_content',
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', details: parsed.error.flatten() }, { status: 400 });
  }
  const { brandId, type, instruction, platform } = parsed.data;

  const gate = await canUseFeature(user, ACTION_BY_TYPE[type]);
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

    const { systemPrompt, userPrompt } = buildContentAssetPrompt(
      type,
      { name: brand.name, description: brand.description, colors: brand.brand_colors, fonts: brand.brand_fonts },
      instruction,
      platform
    );

    const raw = await generateWithGemini({ task: 'content_generation', systemPrompt, userPrompt, jsonSchema: true });
    const spec = JSON.parse(raw);

    const { data: asset, error: assetError } = await supabase
      .from('content_assets')
      .insert({
        user_id: user.id,
        brand_id: brandId,
        type,
        url: spec.imageUrl ?? null, // populated once the image-generation step (or a downstream asset pipeline) runs
        caption: spec.caption ?? spec.text ?? null,
        status: 'draft',
      })
      .select()
      .single();
    if (assetError) throw assetError;

    return NextResponse.json({ asset, spec, creditsRemaining: gate.creditsRemainingAfter });
  } catch (err) {
    await refundCredits(user.id, gate.creditCost);
    console.error('generate-content failed', err);
    return NextResponse.json({ error: 'Generation failed. You have not been charged — please try again.' }, { status: 502 });
  }
}
