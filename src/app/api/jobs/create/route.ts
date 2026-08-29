import { NextResponse } from "next/server";
import type { JobType } from "@/lib/jobs/job-contract";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.type || !body.workspaceId || !body.idempotencyKey) {
      return NextResponse.json(
        { error: "type, workspaceId and idempotencyKey are required" },
        { status: 400 },
      );
    }

    const allowed: JobType[] = [
      "creative_generation",
      "video_generation",
      "campaign_generation",
      "analytics_sync",
      "social_publish",
    ];

    if (!allowed.includes(body.type)) {
      return NextResponse.json({ error: "Unsupported job type" }, { status: 400 });
    }

    return NextResponse.json({
      accepted: true,
      job: {
        id: crypto.randomUUID(),
        state: "queued",
        progress: 0,
        type: body.type,
        workspaceId: body.workspaceId,
      },
    }, { status: 202 });
  } catch {
    return NextResponse.json({ error: "Unable to create job" }, { status: 500 });
  }
}
