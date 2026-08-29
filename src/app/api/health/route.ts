import {NextResponse} from "next/server";
export async function GET(){return NextResponse.json({ok:true,service:"owbrand",timestamp:new Date().toISOString(),version:process.env.APP_VERSION??"development"});}
