import { NextResponse } from "next/server";
import { createPublishIdempotencyKey } from "@/lib/publishing/idempotency";
import { DatabasePublishingQueue } from "@/lib/publishing/queue";
import type { SocialPlatform } from "@/lib/publishing/platform-types";

const queue = new DatabasePublishingQueue();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { postId, brandId, platform, mediaUrls, caption, scheduledFor, accessTokenRef } = body as {
      postId?: string;
      brandId?: string;
      platform?: SocialPlatform;
      mediaUrls?: string[];
      caption?: string;
      scheduledFor?: string;
      accessTokenRef?: string;
    };

    if (!postId || !brandId || !platform || !Array.isArray(mediaUrls) || !accessTokenRef) {
      return NextResponse.json(
        { error: "postId, brandId, platform, mediaUrls and accessTokenRef are required" },
        { status: 400 },
      );
    }

    const idempotencyKey = createPublishIdempotencyKey(postId, platform, scheduledFor);

    const result = await queue.enqueue({
      postId,
      brandId,
      platform,
      caption,
      mediaUrls,
      scheduledFor,
      accessTokenRef,
      idempotencyKey,
    });

    return NextResponse.json({
      queued: true,
      jobId: result.jobId,
      idempotencyKey,
      status: scheduledFor ? "scheduled" : "queued",
    });
  } catch {
    return NextResponse.json({ error: "Unable to queue publishing job" }, { status: 500 });
  }
}
