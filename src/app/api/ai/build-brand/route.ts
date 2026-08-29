import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateWithGemini, trimForPrompt } from '@/lib/gemini';
import { BRAND_BRAIN_SYSTEM } from '@/lib/prompts/brand';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const Body = z.object({ brandName: z.string().min(1).max(100), description: z.string().min(20).max(10000), industry: z.string().optional() });
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Please provide a brand name and a detailed description.' }, { status: 400 });
  const db = supabaseAdmin();
  const { data: sub } = await db.from('subscriptions').select('plan,credits_remaining').eq('user_id', user.id).maybeSingle();
  const cost = 250;
  if ((sub?.credits_remaining ?? 0) < cost && user.role !== 'admin') return NextResponse.json({ error: 'Not enough AI credits.' }, { status: 402 });
  try {
    if (user.role !== 'admin') { const { error } = await db.rpc('deduct_credits', { p_user_id: user.id, p_amount: cost }); if (error) throw error; }
    const raw = await generateWithGemini({ task: 'content_generation', systemPrompt: BRAND_BRAIN_SYSTEM, userPrompt: JSON.stringify({ brandName: parsed.data.brandName, description: trimForPrompt(parsed.data.description, 7000), industry: parsed.data.industry }), jsonSchema: true, maxOutputTokens: 5000, priority: sub?.plan === 'pro' || sub?.plan === 'business' });
    const brain = JSON.parse(raw);
    const { data: workspace } = await db.from('workspaces').select('id').eq('owner_id', user.id).order('created_at').limit(1).maybeSingle();
    const { data: brand, error } = await db.from('brands').insert({ user_id: user.id, workspace_id: workspace?.id ?? null, name: parsed.data.brandName, description: parsed.data.description, brand_colors: brain.identity?.colors?.map((c: any) => c.hex).filter(Boolean) ?? [], brand_fonts: [brain.identity?.fonts?.heading, brain.identity?.fonts?.body].filter(Boolean) }).select().single();
    if (error || !brand) throw error ?? new Error('Could not create brand');
    await db.from('brand_profiles').insert({ brand_id: brand.id, industry: brain.business?.industry ?? parsed.data.industry ?? '', business_type: brain.business?.businessType ?? '', location: brain.business?.location ?? '', target_markets: brain.business?.targetMarkets ?? [], goals: brain.business?.goals ?? [], target_audience: brain.audience ?? {}, positioning: brain.positioning ?? {}, personality: brain.identity?.personality ?? [], tone: brain.identity?.tone ?? [], voice: brain.identity?.voice ?? '', story: brain.identity?.story ?? '', usp: brain.positioning?.usp ?? '', competitors: brain.positioning?.competitors ?? [] });
    await db.from('brand_guidelines').insert({ brand_id: brand.id, colors: { palette: brain.identity?.colors ?? [] }, typography: brain.identity?.fonts ?? {}, photography: brain.guidelines?.photography ?? {}, logo_rules: {}, do_rules: brain.guidelines?.doRules ?? [], dont_rules: brain.guidelines?.dontRules ?? [], preferred_words: brain.guidelines?.preferredWords ?? [], avoided_words: brain.guidelines?.avoidedWords ?? [] });
    const rules = [...(brain.guidelines?.doRules ?? []).map((rule: string) => ({ brand_id: brand.id, rule, type: 'do' })), ...(brain.guidelines?.dontRules ?? []).map((rule: string) => ({ brand_id: brand.id, rule, type: 'dont' }))];
    if (rules.length) await db.from('brand_rules').insert(rules);
    const recommendations = brain.recommendations ?? [];
    if (recommendations.length) await db.from('ai_recommendations').insert(recommendations.map((r: any) => ({ brand_id: brand.id, title: r.title ?? 'Recommendation', recommendation: r.recommendation ?? '', priority: r.priority ?? 'medium' })));
    const { data: updatedSub } = await db.from('subscriptions').select('credits_remaining').eq('user_id', user.id).maybeSingle();
    return NextResponse.json({ brand, brain, creditsRemaining: updatedSub?.credits_remaining ?? 0 });
  } catch (error) {
    if (user.role !== 'admin') { try { await db.rpc('refund_credits', { p_user_id: user.id, p_amount: cost }); } catch { /* best-effort refund */ } }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Brand generation failed.' }, { status: 500 });
  }
}
