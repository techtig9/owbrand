# OwBrand Phase 15 — Persistent Domain & Workflow Completion

This phase establishes the persistent domain objects required by the golden path.

## Persistent entities

- Brand Brain
- Products
- Generation Jobs
- Campaigns
- Content Items
- Media Assets
- Notification Events

## State machines

### Content
Draft → Generating → Ready → Pending Approval → Approved → Scheduled → Publishing → Published

Failure can move content to `failed`, where it can be retried after the underlying issue is resolved.

### Jobs
Queued → Processing → Succeeded / Failed / Cancelled

### Campaigns
Draft → Active → Completed / Archived

## Production rule

Database writes must be made only after:
1. authentication
2. workspace membership
3. role/permission check
4. plan/usage check where applicable
5. schema validation
6. audit event

Never expose service-role database credentials to the browser.

## Media

Original uploads and generated assets are separate records. Generated assets retain:
- source product
- generation parameters
- model/provider metadata
- creation timestamp

This makes regeneration and auditing possible.
