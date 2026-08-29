import { NextResponse } from "next/server";
import { summarizeAttribution } from "@/lib/analytics/attribution";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const touchpoints = Array.isArray(body.touchpoints) ? body.touchpoints : [];
    return NextResponse.json({ summary: summarizeAttribution(touchpoints) });
  } catch {
    return NextResponse.json({ error: "Unable to calculate attribution" }, { status: 500 });
  }
}
