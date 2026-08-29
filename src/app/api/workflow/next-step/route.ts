import { NextResponse } from "next/server";
import { nextGoldenPathStep } from "@/lib/workflow/golden-path";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const completed = Array.isArray(body.completed) ? body.completed : [];
    return NextResponse.json({
      nextStep: nextGoldenPathStep(completed),
      complete: nextGoldenPathStep(completed) === null,
    });
  } catch {
    return NextResponse.json({ error: "Unable to determine next step" }, { status: 500 });
  }
}
