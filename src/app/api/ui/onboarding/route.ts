import { NextResponse } from "next/server";
import { ONBOARDING_STEPS, onboardingProgress } from "@/lib/ui/onboarding";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const completed = Array.isArray(body.completed) ? body.completed : [];

    return NextResponse.json({
      steps: ONBOARDING_STEPS,
      progress: onboardingProgress(completed),
      completed,
    });
  } catch {
    return NextResponse.json({ error: "Unable to calculate onboarding progress" }, { status: 500 });
  }
}
