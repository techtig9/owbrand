import { NextResponse } from "next/server";
import { generateMarketingRecommendations } from "@/lib/marketing/strategy";
import type { CampaignBrief } from "@/lib/campaigns/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const brief = body.brief as CampaignBrief;
    const recommendations = generateMarketingRecommendations(
      brief,
      body.metrics ?? {},
    );
    return NextResponse.json({ recommendations });
  } catch {
    return NextResponse.json({ error: "Unable to generate recommendations" }, { status: 500 });
  }
}
