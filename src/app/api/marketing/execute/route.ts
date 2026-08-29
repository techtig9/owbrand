import { NextResponse } from "next/server";
import { canExecuteAction, DEFAULT_APPROVAL_POLICY } from "@/lib/marketing/approval";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const policy = body.policy ?? DEFAULT_APPROVAL_POLICY;
    const actions = Array.isArray(body.actions) ? body.actions : [];

    const results = actions.map((action: "generate" | "schedule" | "publish" | "spend") => ({
      action,
      allowed: canExecuteAction(policy, action),
      mode: policy.level,
      status: canExecuteAction(policy, action) ? "ready_for_worker" : "requires_approval",
    }));

    return NextResponse.json({
      runId: body.runId ?? null,
      results,
      executionMode: policy.level,
    });
  } catch {
    return NextResponse.json({ error: "Unable to evaluate marketing execution" }, { status: 500 });
  }
}
