import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { analyzeProductImage } from '@/lib/gemini';

const schema = z.object({ assetId: z.string().uuid(), brandId: z.string().uuid() });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const db = supabaseAdmin();
  const { assetId, brandId } = parsed.data;
  const { data: asset } = await db.from('product_assets').select('id,product_id,url,metadata').eq('id', assetId).maybeSingle();
  if (!asset) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 });
  const { data: product } = await db.from('products').select('id,name,description,brand_id').eq('id', asset.product_id).eq('brand_id', brandId).maybeSingle();
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  const { data: brand } = await db.from('brands').select('id,name,description').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 });

  const { data: file, error: downloadError } = await db.storage.from('owbrand-media').download(asset.url);
  if (downloadError || !file) return NextResponse.json({ error: 'Could not read uploaded image.' }, { status: 422 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = Buffer.from(bytes).toString('base64');
  const contentType = String(asset.metadata?.contentType || file.type || 'image/jpeg');
  try {
    const raw = await analyzeProductImage(base64, contentType, `${brand.name}: ${brand.description}. Product: ${product.name}. ${product.description}`);
    let analysis: unknown = raw;
    try { analysis = JSON.parse(raw); } catch { /* preserve raw output if model formatting slips */ }
    const { data: updated, error } = await db.from('product_assets').update({ analysis, status: 'analyzed' }).eq('id', assetId).select().single();
    if (error) throw error;
    return NextResponse.json({ asset: updated, analysis });
  } catch (error) {
    console.error('product image analysis failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Image analysis failed.' }, { status: 502 });
  }
}
