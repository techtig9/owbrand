import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
const schema=z.object({path:z.string().min(1)});
export async function POST(req:Request){
 const user=await getCurrentUser(); if(!user)return NextResponse.json({error:'Unauthorized.'},{status:401});
 const p=schema.safeParse(await req.json()); if(!p.success)return NextResponse.json({error:'Invalid path.'},{status:400});
 if(!p.data.path.startsWith(`${user.id}/`))return NextResponse.json({error:'Forbidden.'},{status:403});
 const db=supabaseAdmin(); const {data,error}=await db.storage.from('owbrand-media').createSignedUrl(p.data.path,3600);
 if(error||!data)return NextResponse.json({error:error?.message||'Could not sign media URL.'},{status:500});
 return NextResponse.json({url:data.signedUrl});
}
