# OwBrand Phase 3 — Publishing + Campaign Orchestration

This phase adds the production architecture for:

- AI campaign planning
- Social post records
- Publishing jobs
- Idempotent scheduling
- Platform adapter boundaries
- Campaign tasks
- Social insight snapshots

## Important production rule

OwBrand must never expose social access tokens to the browser. OAuth tokens should be stored encrypted/server-side and referenced by `accessTokenRef`.

## Current implementation

### Campaign planning
`POST /api/campaigns/plan`

Accepts a campaign brief and returns a structured plan containing:

- strategy
- content pillars
- recommended asset quantities
- publishing cadence
- KPIs

### Publishing queue
`POST /api/social/publish`

Creates an idempotent publishing job. It deliberately queues work rather than pretending that an HTTP request is a reliable long-running publishing worker.

### Platform adapters

`src/lib/publishing/platform-types.ts`

defines the provider contract. Add one official API adapter per platform:

- Instagram
- Facebook
- TikTok
- YouTube
- LinkedIn
- Pinterest
- X

Only use each platform's current official API and permitted publishing scopes.

## Next production work

1. Implement OAuth initiation/callback for each selected platform.
2. Store refresh/access tokens in secure server-side secret storage.
3. Implement workers using the `publishing_jobs` table.
4. Add retry/backoff and dead-letter handling.
5. Add platform-specific media validation.
6. Add approval gating.
7. Build the AI content calendar.
8. Pull platform analytics into `social_insights`.
9. Connect campaign tasks to the AI asset-generation pipeline.
10. Add ad-account adapters after organic publishing is stable.

## Product behavior

Campaign creation should eventually work as:

Business/Brand Brain
→ campaign brief
→ AI strategy
→ asset tasks
→ creative generation
→ approval
→ scheduling
→ publishing
→ analytics
→ AI recommendations

This is the foundation for OwBrand's autonomous marketing loop.
