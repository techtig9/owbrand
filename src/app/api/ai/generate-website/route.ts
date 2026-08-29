import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canUseFeature, refundCredits } from '@/lib/credits';
import { generateWithGemini } from '@/lib/gemini';
import { buildWebsitePrompt } from '@/lib/prompts/website';

const bodySchema = z.object({
  brandId: z.string().uuid().optional(), // omit to create a new brand from this generation
  brandName: z.string().min(1).max(80),
  description: z.string().min(1).max(4000),
  websiteType: z.string().optional(),
  theme: z.string().optional(),
  colorPreference: z.string().optional(),
  style: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  importedContent: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', details: parsed.error.flatten() }, { status: 400 });
  }
  const brief = parsed.data;

  const action = brief.sourceUrl ? 'generate_website_from_url' : 'generate_website';
  const gate = await canUseFeature(user, action);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason, upgradeRequired: true }, { status: 402 });
  }

  try {
    const { systemPrompt, userPrompt } = buildWebsitePrompt(brief);
    const raw = await generateWithGemini({
      task: 'website_generation',
      systemPrompt,
      userPrompt,
      jsonSchema: true,
      maxOutputTokens: 8192,
    });

    const site = JSON.parse(raw);

    const supabase = supabaseAdmin();
    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .upsert(
        brief.brandId
          ? { id: brief.brandId, user_id: user.id, name: brief.brandName, description: brief.description }
          : { user_id: user.id, name: brief.brandName, description: brief.description }
      )
      .select()
      .single();

    if (brandError) throw brandError;

    return NextResponse.json({
      brand,
      site,
      creditsRemaining: gate.creditsRemainingAfter,
    });
  } catch (err) {
    // Generation failed after credits were reserved — roll the deduction back.
    await refundCredits(user.id, gate.creditCost);
    console.error('generate-website failed', err);
    return NextResponse.json({ error: 'Generation failed. You have not been charged — please try again.' }, { status: 502 });
  }
}
