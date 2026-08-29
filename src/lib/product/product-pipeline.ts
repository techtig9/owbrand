export type ProductPipelineStep =
  | "normalize_product"
  | "validate_facts"
  | "generate_shoot_brief"
  | "generate_creatives"
  | "generate_copy"
  | "create_campaign_assets"
  | "approval";

export interface ProductPipelineInput {
  productId: string;
  productName: string;
  sourceImages: string[];
  approvedFacts: Record<string, unknown>;
  brandRules: Record<string, unknown>;
}

export function buildProductPipeline(input: ProductPipelineInput) {
  const steps: ProductPipelineStep[] = [
    "normalize_product",
    "validate_facts",
    "generate_shoot_brief",
    "generate_creatives",
    "generate_copy",
    "create_campaign_assets",
    "approval",
  ];

  return {
    productId: input.productId,
    steps,
    guardrails: {
      useOnlyApprovedFacts: true,
      preserveBrandRules: true,
      neverInventReviews: true,
      neverInventSpecifications: true,
      neverInventPrices: true,
    },
    sourceImages: input.sourceImages,
  };
}
