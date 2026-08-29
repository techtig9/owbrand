import { NextResponse } from "next/server";
import { buildCampaignPlan } from "@/lib/campaigns/planner";
import type { CampaignBrief } from "@/lib/campaigns/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CampaignBrief;

    if (!body.brandId || !body.name || !body.goal || !body.startDate || !body.endDate) {
      return NextResponse.json(
        { error: "brandId, name, goal, startDate and endDate are required" },
        { status: 400 },
      );
    }

    const plan = buildCampaignPlan(body);
    return NextResponse.json({ plan });
  } catch {
    return NextResponse.json({ error: "Unable to create campaign plan" }, { status: 500 });
  }
}
