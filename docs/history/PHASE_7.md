# OwBrand Phase 7 — Analytics + AI Optimization

Phase 7 closes the feedback loop.

## Loop

Publish
→ collect metrics
→ normalize metrics
→ attribute outcomes
→ calculate performance
→ generate optimization actions
→ user approval / automation policy
→ create improved content
→ publish again

## Added

### Analytics normalization
`analytics_daily` stores platform metrics in one normalized model.

### Attribution
`attribution_touchpoints` stores measurable customer touchpoints and revenue/conversion signals.

### Optimization engine
The optimizer evaluates:
- engagement rate
- CTR
- ROAS
- delivery volume
- conversion volume

and creates explainable actions such as:
- improve hooks
- test CTA
- refresh creative
- double down on winners
- shift budget
- collect more data

### API
`POST /api/analytics/optimize`

`POST /api/analytics/attribution`

## Production analytics adapters

Add official API ingestion adapters for each connected platform. Each adapter should:
1. fetch only permitted metrics
2. normalize them into `analytics_daily`
3. preserve raw provider data for debugging
4. deduplicate by account/platform/date
5. respect API rate limits
6. record sync errors
7. record last successful sync

## Attribution

For owned websites/stores, use first-party events and consent-aware analytics. Do not claim revenue attribution where the data cannot support it.

## Phase 8 target

Turn OwBrand into a complete SaaS business:
- billing/credits
- subscriptions
- workspaces and teams
- roles/permissions
- onboarding
- usage metering
- limits
- agency mode
- notifications
- support
- observability
- security hardening
- production deployment
- onboarding-to-value UX
