# OwBrand Phase 14 — Interactive Backend Wiring Foundation

Phase 14 begins the transition from application architecture to real interaction contracts.

## Added

### Session contract
A centralized session shape defines:
- user
- workspace
- role

Private operations should require a verified session before touching tenant data.

### Workspace isolation
Every tenant operation must carry a workspace context and verify membership before reading or mutating data.

### Job contract

Long-running work is standardized as jobs:
- creative generation
- video generation
- campaign generation
- analytics synchronization
- social publishing

Jobs have:
- idempotency key
- workspace
- type
- payload
- state
- progress
- error

## Why jobs matter

AI image/video generation and social publishing can take seconds or minutes and can fail due to provider limits. The browser should not wait on a single long HTTP request.

The intended flow is:

UI
→ authenticated API
→ validate permissions/usage
→ create idempotent job
→ queue
→ worker
→ provider
→ persist result
→ notify UI

## Golden-path wiring

### Brand
UI reads and edits the persistent Brand Brain.

### Product
UI creates product records, uploads source media and edits approved facts.

### Creative
UI creates a generation job. Progress is displayed in the Creative Studio.

### Campaign
Campaign wizard saves a draft before expensive generation begins.

### Approval
Approval changes content state and creates an audit event.

### Calendar
Scheduling creates/updates publishing jobs rather than directly calling provider APIs from the browser.

### Social
OAuth connections remain server-side and publishing uses secure provider adapters.

### Analytics
Analytics sync is asynchronous and deduplicated.

## Critical rule

Never let the browser:
- directly publish using social secrets
- decide its own plan entitlement
- bypass workspace authorization
- mark an expensive job as completed
- write arbitrary analytics
- claim payment success

All of these must be verified server-side.

## Phase 15 target

Build the actual persistent CRUD and job lifecycle:
- authenticated workspace CRUD
- Brand Brain CRUD
- product CRUD
- secure media uploads
- creative job creation/status
- campaign CRUD
- approval mutations
- calendar scheduling
- notification events
- audit events
- real database queries
- automated integration tests.
