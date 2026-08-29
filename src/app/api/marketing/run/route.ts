import { NextResponse } from "next/server";
import { buildMarketingRun } from "@/lib/marketing/run-marketing";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.brandId) {
      return NextResponse.json({ error: "brandId is required" }, { status: 400 });
    }

    const result = buildMarketingRun({
      brandId: body.brandId,
      platforms: Array.isArray(body.platforms) ? body.platforms : ["instagram"],
      primaryProduct: body.primaryProduct,
      metrics: body.metrics ?? {},
      campaign: body.campaign,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Unable to run marketing plan" }, { status: 500 });
  }
}
