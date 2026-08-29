import { PLANS, type PlanId } from "./plans";

export type UsageMetric =
  | "ai_generations"
  | "image_generations"
  | "video_generations"
  | "scheduled_posts"
  | "published_posts"
  | "team_members";

export function getPlanLimit(planId: PlanId, metric: UsageMetric) {
  const plan = PLANS[planId];

  if (metric === "team_members") return plan.maxMembers;
  if (metric === "ai_generations") return plan.credits;
  if (metric === "image_generations") return Math.floor(plan.credits / 2);
  if (metric === "video_generations") return Math.floor(plan.credits / 10);
  if (metric === "scheduled_posts") return plan.credits * 2;
  if (metric === "published_posts") return plan.credits;
  return 0;
}

export function hasCapacity(planId: PlanId, metric: UsageMetric, used: number) {
  return used < getPlanLimit(planId, metric);
}
