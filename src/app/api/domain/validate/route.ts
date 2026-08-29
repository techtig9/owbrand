import { NextResponse } from "next/server";
import { requiredString, safeObject } from "@/lib/domain/validation";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const entity = requiredString(body.entity, "entity");
    const payload = safeObject(body.payload);
    return NextResponse.json({ valid: true, entity, payload });
  } catch (error) {
    return NextResponse.json(
      { valid: false, error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 },
    );
  }
}
