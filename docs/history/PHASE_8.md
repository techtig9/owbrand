# OwBrand Phase 8 — Complete SaaS Business Layer

This phase turns the marketing engine into a commercially structured SaaS.

## Added

### Plans
Free, Starter, Growth, Agency and Enterprise plan definitions.

### Usage metering
A centralized usage layer provides limits for:
- AI generations
- image generations
- video generations
- scheduled posts
- published posts
- team members

### Workspace roles
- Owner
- Admin
- Editor
- Approver
- Viewer

### Commercial data model
- subscriptions
- usage_events
- workspace_members
- notifications
- support_tickets
- audit_events

## Billing integration boundary

The database stores provider-neutral subscription metadata. A production billing adapter should connect the existing billing provider to:
- checkout
- subscription creation
- renewals
- failed payments
- cancellations
- plan changes
- webhook reconciliation
- invoices

Never trust a browser-side plan value for access control; derive entitlement server-side from the verified subscription state.

## Product UX that should be built around this phase

Onboarding:
1. Create workspace
2. Describe business
3. Build Brand Brain
4. Add first product
5. Upload product photos
6. Connect social accounts
7. Select automation level
8. Generate first campaign
9. Review first results

Core navigation:
Dashboard → Brand → Products → Creative Studio → Campaigns → Calendar → Social → Analytics → AI Recommendations → Team → Billing → Settings → Help.

## Security requirements

- Server-side authorization for every mutation
- Workspace membership checks
- RLS on all tenant data
- Secret/token isolation
- Audit important actions
- Rate limiting on AI and upload endpoints
- Signed media URLs
- Webhook signature verification
- Idempotent billing/publishing jobs

## Phase 9 target

Final product hardening and launch:
- complete polished UI
- onboarding
- billing screens
- team management
- production OAuth flows
- deployment configuration
- observability
- error tracking
- automated tests
- security review
- performance optimization
- backups/recovery
- legal/product settings
- launch checklist
