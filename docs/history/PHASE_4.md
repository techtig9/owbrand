# OwBrand Phase 4 — Autonomous Marketing Engine

Phase 4 adds the intelligence layer that turns OwBrand from a content tool into an operating loop.

## Core loop

Brand Brain
→ campaign strategy
→ 30-day content calendar
→ content briefs
→ creative generation
→ approval
→ publishing queue
→ platform metrics
→ AI analysis
→ recommendations
→ new content

## Included

- Central AI orchestrator boundary
- 30-day content calendar generation
- Marketing recommendation engine
- Agent-run persistence schema
- Calendar persistence schema
- Recommendation persistence schema
- Guardrails for approved brand decisions and factual product information

## Production integration

The next implementation should connect:

1. Existing Brand Brain retrieval
2. Product Brain retrieval
3. Gemini/selected LLM provider
4. Product image/video generation from Phase 2
5. Social publishing from Phase 3
6. Real platform analytics ingestion
7. Approval UI
8. Background workers
9. Recommendation actions

## Safety/quality behavior

AI must not invent:
- product specifications
- prices
- stock
- warranties
- return policies
- shipping promises
- customer testimonials

AI should use approved Brand Brain and Product Brain facts as its source of truth.

## Product goal

The user should eventually be able to press:

### Run My Marketing

and OwBrand will prepare the next approved set of actions, show the reasoning, and execute only the actions allowed by the user's automation level.
