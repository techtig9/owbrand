import {NextResponse} from "next/server";
export async function GET(){return NextResponse.json({ready:true,checks:{application:"ok",database:"pending-runtime-check",worker:"pending-runtime-check"}});}
