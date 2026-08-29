import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    return NextResponse.json({
      workspaceId: body.workspaceId,
      role: body.role ?? "owner",
      planId: body.planId ?? "free",
    });
  } catch {
    return NextResponse.json({ error: "Invalid workspace context" }, { status: 400 });
  }
}
