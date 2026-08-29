import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const schema = z.object({
  brandId: z.string().uuid(),
  productId: z.string().uuid(),
  fileName: z.string().min(1).max(180),
  contentType: z.string().regex(/^image\/(jpeg|png|webp|jpg)$/i),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 });

  const { brandId, productId, fileName, contentType } = parsed.data;
  const db = supabaseAdmin();
  const { data: product } = await db.from('products').select('id,name,brand_id').eq('id', productId).eq('brand_id', brandId).maybeSingle();
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  const { data: brand } = await db.from('brands').select('id').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 });

  const safe = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const path = `${user.id}/${brandId}/${productId}/${crypto.randomUUID()}-${safe}`;
  const { data, error } = await db.storage.from('owbrand-media').createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message || 'Could not create upload URL.' }, { status: 500 });

  const { data: asset, error: assetError } = await db.from('product_assets').insert({
    product_id: productId,
    type: 'original',
    source: 'user_upload',
    url: path,
    status: 'uploaded',
    metadata: { contentType, originalFileName: fileName },
  }).select().single();
  if (assetError) return NextResponse.json({ error: assetError.message }, { status: 500 });

  return NextResponse.json({ asset, path, token: data.token, bucket: 'owbrand-media' });
}
