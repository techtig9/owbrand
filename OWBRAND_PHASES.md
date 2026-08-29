# OwBrand implementation phases

OwBrand is now organized around a Brand Brain rather than disconnected generators.

## Phase 1 — Foundation (implemented in this release)
- Brand Brain data model and RLS
- Conversational-style brand onboarding
- AI Build My Brand endpoint
- Brand profile, guidelines and persistent brand rules
- Product catalog foundation
- Product-aware AI Studio
- Campaign foundation
- Analytics/recommendations dashboard
- New command-center navigation
- Existing authentication, billing, credits, website generation, templates, scheduler and social foundations retained

## Phase 2 — Creative production
- Supabase Storage upload flow for original product photos
- Product image analysis and consistency controls
- Image-generation provider adapter
- Background replacement and product photography presets
- Video provider adapter
- Reel/video rendering queue
- Voice and caption generation
- Asset versioning and approvals

## Phase 3 — Publishing + campaigns
- Official OAuth connectors for supported social platforms
- Token encryption/rotation
- Publishing workers and idempotency keys
- AI content calendar and best-time recommendations
- Meta/Google/TikTok ad adapters where API access is approved
- Campaign planner that generates coordinated social, ad, email and landing-page assets

## Phase 4 — Intelligence
- Platform analytics ingestion
- Unified metrics model
- AI Marketing Manager
- A/B testing
- Creative performance attribution
- Recommendation engine
- Autonomous but approval-gated optimization loop

## Phase 5 — Business platform
- Shopify/WooCommerce synchronization
- AI customer-support knowledge base
- Team roles and client workspaces
- Agency/white-label mode
- API and webhooks
- Enterprise security/SSO/audit controls

## Production requirements before launch
- Configure Supabase, Gemini and Paddle secrets
- Run the schema on a fresh Supabase project or write a controlled migration from the old schema
- Add Storage buckets and signed-upload policies
- Add production OAuth applications and platform review where required
- Add image/video provider credentials for actual media generation
- Configure a durable background worker/queue for video, publishing and analytics jobs
- Add monitoring, error tracking, backups and rate limits
- Test every external connector in sandbox/test environments before enabling autonomous publishing

## Phase 2 — Creative production (implemented foundation)
- Private Supabase media bucket and signed upload/read flow
- Original product image uploads from Product Studio
- Gemini product-image analysis with structured visual metadata
- Product asset analysis/status tracking
- Media job table for durable creative generation work
- Product asset version table
- Provider-neutral image-generation adapter with explicit configuration boundary
- Product Photo Studio UI and analysis workflow

### Remaining production wiring for Phase 2
- Choose and configure a production image model/provider at IMAGE_PROVIDER_URL
- Add a durable worker for media_jobs rather than holding long generation requests open
- Add actual video provider credentials/adapter
- Add image/video moderation and output validation
- Add generated-asset version/approval UI

## Phase 2 — additional creative workflow completed
- Product video provider adapter and generation job route
- Product video job persistence and output asset creation when provider returns immediately
- Asset approval endpoint foundation
- Image/video provider contracts documented through environment variables
