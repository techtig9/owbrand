import { NextResponse } from "next/server";
import { validateMedia } from "@/lib/publishing/media-validation";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const kind = body.kind === "video" ? "video" : "image";
    const media = Array.isArray(body.media) ? body.media : [];

    return NextResponse.json({
      kind,
      results: validateMedia(media, kind),
    });
  } catch {
    return NextResponse.json({ error: "Unable to validate media" }, { status: 500 });
  }
}
