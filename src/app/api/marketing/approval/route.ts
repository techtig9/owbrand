import { NextResponse } from "next/server";
import { canExecuteAction, DEFAULT_APPROVAL_POLICY } from "@/lib/marketing/approval";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const policy = body.policy ?? DEFAULT_APPROVAL_POLICY;

    const requestedActions = Array.isArray(body.actions) ? body.actions : [];
    const allowed = requestedActions.filter((action: "generate" | "schedule" | "publish" | "spend") =>
      canExecuteAction(policy, action),
    );

    return NextResponse.json({
      policy,
      requestedActions,
      allowedActions: allowed,
      blockedActions: requestedActions.filter((a: string) => !allowed.includes(a)),
    });
  } catch {
    return NextResponse.json({ error: "Unable to evaluate approval policy" }, { status: 500 });
  }
}
