import { NextResponse } from "next/server";
import { build30DayCalendar } from "@/lib/marketing/calendar";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const platforms = Array.isArray(body.platforms) ? body.platforms : ["instagram"];
    const calendar = build30DayCalendar(platforms, body.primaryProduct);
    return NextResponse.json({ calendar });
  } catch {
    return NextResponse.json({ error: "Unable to generate calendar" }, { status: 500 });
  }
}
