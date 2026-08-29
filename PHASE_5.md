# OwBrand Phase 5 — Run My Marketing + Autonomous Controls

Phase 5 turns the previous AI planning components into an explainable orchestration layer.

## Main feature

### Run My Marketing

The user supplies a brand and platforms. OwBrand prepares:

1. 30-day content calendar
2. Marketing recommendations
3. Content-generation actions
4. Publishing actions
5. Analytics collection actions

The current implementation is **plan-first** and approval-safe.

## Automation levels

### Manual
AI can generate. User approves everything.

### Assisted
AI prepares and schedules approved work, but publishing/spending remains controlled.

### Autonomous
Future production worker can execute actions permitted by the configured policy.

## Important safety boundary

OwBrand must never automatically spend advertising money unless the user explicitly enables that capability.

The default policy is:

- auto publish: false
- auto create ads: true
- auto spend money: false

## API

`POST /api/marketing/run`

Creates an explainable marketing plan.

`POST /api/marketing/approval`

Evaluates which requested actions are allowed by the current automation policy.

## Production worker work

The next integration stage should connect these actions to:

- Phase 2 media generation jobs
- Phase 3 social publishing queue
- real analytics ingestion
- approval UI
- background workers
- official advertising APIs

The worker should use idempotency keys and never execute an action twice.
