import { NextResponse } from "next/server";
import { optimize } from "@/lib/analytics/optimizer";

export async function POST(request: Request) {
  try {
    const snapshot = await request.json();
    return NextResponse.json({ actions: optimize(snapshot) });
  } catch {
    return NextResponse.json({ error: "Unable to optimize performance" }, { status: 500 });
  }
}
