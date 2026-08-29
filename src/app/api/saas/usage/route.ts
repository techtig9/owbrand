import { NextResponse } from "next/server";
import { getPlanLimit, hasCapacity } from "@/lib/saas/usage";
import type { PlanId, } from "@/lib/saas/plans";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const plan = (body.plan ?? "free") as PlanId;
    const metric = body.metric;
    const used = Number(body.used ?? 0);

    return NextResponse.json({
      plan,
      metric,
      used,
      limit: getPlanLimit(plan, metric),
      allowed: hasCapacity(plan, metric, used),
    });
  } catch {
    return NextResponse.json({ error: "Unable to calculate usage" }, { status: 500 });
  }
}
