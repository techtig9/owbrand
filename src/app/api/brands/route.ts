import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server'; import { supabaseAdmin } from '@/lib/supabase/admin';
export async function GET(){const user=await getCurrentUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});const {data,error}=await supabaseAdmin().from('brands').select('id,name,description,brand_colors,brand_fonts').eq('user_id',user.id).order('created_at',{ascending:false});return NextResponse.json({brands:data||[],error:error?.message});}
