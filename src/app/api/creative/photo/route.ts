import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateProductPhotos } from '@/lib/media/provider';

const schema = z.object({
  brandId: z.string().uuid(), productId: z.string().uuid(), sourceAssetId: z.string().uuid(),
  style: z.string().min(1).max(80), scene: z.string().min(1).max(160), aspectRatio: z.string().default('1:1'), count: z.number().int().min(1).max(6).default(4),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid photo generation request.' }, { status: 400 });
  const { brandId, productId, sourceAssetId, style, scene, aspectRatio, count } = parsed.data;
  const db = supabaseAdmin();
  const { data: brand } = await db.from('brands').select('id,name,description,brand_colors,brand_fonts').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  const { data: product } = await db.from('products').select('*').eq('id', productId).eq('brand_id', brandId).maybeSingle();
  const { data: source } = await db.from('product_assets').select('*').eq('id', sourceAssetId).eq('product_id', productId).maybeSingle();
  if (!brand || !product || !source) return NextResponse.json({ error: 'Brand, product or source asset not found.' }, { status: 404 });

  const prompt = `Create ${count} commercially polished product photographs for ${brand.name}. Product: ${product.name}. Preserve the exact product identity, packaging, logo, label, proportions and colors from the reference. Style: ${style}. Scene: ${scene}. Aspect ratio: ${aspectRatio}. Brand colors: ${(brand.brand_colors || []).join(', ')}. Do not invent product claims or change packaging text.`;
  const { data: job, error: jobError } = await db.from('media_jobs').insert({ user_id: user.id, brand_id: brandId, product_id: productId, source_asset_id: sourceAssetId, kind: 'product_photo_generation', provider: process.env.IMAGE_PROVIDER || 'unconfigured', input: { prompt, style, scene, aspectRatio, count } }).select().single();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  try {
    const result = await generateProductPhotos({ prompt, aspectRatio, count, metadata: { brandId, productId, sourceAssetId } });
    const inserted = [];
    for (let i = 0; i < result.assets.length; i++) {
      const a = result.assets[i];
      const { data } = await db.from('product_assets').insert({ product_id: productId, type: 'ai_photo', source: 'ai_generated', url: a.url, prompt, metadata: { ...a.metadata, provider: result.provider, sourceAssetId, style, scene, aspectRatio } }).select().single();
      if (data) inserted.push(data);
    }
    await db.from('media_jobs').update({ status: 'completed', output: { assets: inserted.map(x => x.id) }, completed_at: new Date().toISOString() }).eq('id', job.id);
    return NextResponse.json({ jobId: job.id, assets: inserted, provider: result.provider });
  } catch (error) {
    await db.from('media_jobs').update({ status: 'failed', error: error instanceof Error ? error.message : 'Generation failed.', completed_at: new Date().toISOString() }).eq('id', job.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Photo generation failed.', jobId: job.id }, { status: 502 });
  }
}
