# OwBrand Phase 10 — Product Audit, Integration Map & Unified Product Pipeline

Phase 10 changes the approach from "keep adding isolated features" to connecting the product into one coherent operating system.

## Unified product pipeline

User uploads normal product images
→ product facts are normalized
→ facts are validated against approved information
→ AI creates a product-shoot brief
→ image/video generation jobs are created
→ product copy is generated
→ campaign assets are assembled
→ user/automation policy approves
→ assets enter publishing queue
→ posts are published
→ analytics are collected
→ AI optimization improves the next cycle.

## Feature matrix

The `/api/qa/feature-matrix` endpoint exposes which major areas are implemented, which still need external integrations, and what should happen next.

This prevents the project from pretending that an architecture component is already a working third-party integration.

## Product guardrails

All product-generation workflows must preserve:
- approved product facts
- approved brand rules
- factual specifications
- pricing
- availability
- policy information

AI must not fabricate:
- customer reviews
- product specifications
- prices
- certifications
- guarantees
- medical/legal claims
- performance claims

## Phase 10 focus

The goal is now vertical integration: one real product should be able to travel through the entire system.

### Golden-path test

1. Create workspace.
2. Create brand.
3. Add one product.
4. Upload 1–5 normal product images.
5. Approve product facts.
6. Generate a product-shoot brief.
7. Generate at least one creative.
8. Generate caption/copy.
9. Create a campaign.
10. Put content into approval.
11. Schedule it.
12. Publish through a configured provider.
13. Collect analytics.
14. Generate an optimization recommendation.

If this golden path works in staging, OwBrand has a demonstrable end-to-end product rather than a collection of modules.

## Phase 11 target

Next build the polished customer-facing application around the golden path:
- complete dashboard UI
- visual Brand Brain editor
- Product Brain editor
- Creative Studio
- AI product-shoot interface
- video/reel builder
- campaign wizard
- content calendar
- approval inbox
- social connections
- analytics dashboards
- billing
- team management
- notifications
- onboarding checklist
- empty/loading/error/success states
- responsive mobile experience.
