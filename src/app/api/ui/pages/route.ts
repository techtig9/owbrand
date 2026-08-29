import { NextResponse } from "next/server";
import { PAGE_CONFIGS } from "@/lib/ui/page-config";

export async function GET() {
  return NextResponse.json({
    pages: PAGE_CONFIGS,
    count: PAGE_CONFIGS.length,
  });
}
