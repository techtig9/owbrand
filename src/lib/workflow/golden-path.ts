export const GOLDEN_PATH = [
  "create_workspace",
  "build_brand",
  "add_product",
  "upload_source_images",
  "approve_product_facts",
  "generate_creative",
  "generate_copy",
  "create_campaign",
  "approve_content",
  "schedule_content",
  "publish_content",
  "collect_analytics",
  "optimize_next_campaign",
] as const;

export type GoldenPathStep = typeof GOLDEN_PATH[number];

export function nextGoldenPathStep(completed: GoldenPathStep[]): GoldenPathStep | null {
  return GOLDEN_PATH.find((step) => !completed.includes(step)) ?? null;
}
