export type MarketingTask =
  | "brand_strategy"
  | "product_copy"
  | "social_calendar"
  | "campaign_plan"
  | "ad_creative"
  | "analytics_analysis";

export interface OrchestratorContext {
  brandId: string;
  task: MarketingTask;
  brandBrain?: unknown;
  productBrain?: unknown;
  campaign?: unknown;
  metrics?: unknown;
}

/**
 * Central AI boundary. Every future AI agent should receive the Brand Brain
 * and Product Brain through this layer instead of inventing its own context.
 */
export function buildAgentContext(input: OrchestratorContext) {
  return {
    task: input.task,
    brand: input.brandBrain ?? {},
    products: input.productBrain ?? {},
    campaign: input.campaign ?? {},
    metrics: input.metrics ?? {},
    rules: {
      preserveApprovedBrandDecisions: true,
      neverInventProductFacts: true,
      neverInventPolicies: true,
    },
  };
}
