# OwBrand Phase 13 — Interactive Application Shell & Golden Path

Phase 13 turns the design-system architecture into a complete screen map and connects the application around one customer journey.

## Complete application screens

### Dashboard
The command center showing:
- brand health
- upcoming content
- approvals
- campaign performance
- AI recommendations
- usage

### Brand Brain
The source of truth for:
- identity
- voice
- audience
- visual rules
- products
- AI guardrails

### Products
The product library contains:
- product facts
- source images
- generated creatives
- creative history

### Creative Studio
The central creation workspace:
- upload source
- select generation goal
- generate
- compare variations
- create copy
- export/send to campaign

### Campaigns
Campaign lifecycle:
Draft → Creative → Approval → Scheduled → Publishing → Live → Analytics → Optimization.

### Content Calendar
Month/week/day views with platform, campaign, approval and publishing states.

### Approval Inbox
One place for:
- review
- approve
- reject
- request edits

### Social Accounts
Connection health, permissions and publishing readiness.

### Analytics
Performance by:
- campaign
- content
- platform
- conversion
- revenue

### AI Recommendations
Recommendations should be:
- explainable
- prioritized
- tied to actual data
- actionable
- reversible when automation is enabled

### Team
Members, roles, invitations and activity.

### Billing
Plan, usage, invoices and payment information.

### Settings
Workspace, automation, notifications, security and integrations.

### Help
Guides, support tickets and system status.

## Golden path

The app should always know the user's next useful action:

Workspace
→ Brand
→ Product
→ Source images
→ Approved facts
→ Creative
→ Copy
→ Campaign
→ Approval
→ Schedule
→ Publish
→ Analytics
→ Optimization

The `/api/workflow/next-step` endpoint exposes this logic.

## Critical UX rule

Do not make the user understand OwBrand's internal architecture.

The UI should guide them with plain-language actions such as:

**"Add your first product"**

**"Turn your product photo into a professional campaign image"**

**"Review 3 posts ready to publish"**

rather than technical terms such as "execute creative generation job."

## Phase 14 target

Implement the actual interactive components and data wiring:
- authentication/session shell
- workspace switcher
- dashboard cards
- editable Brand Brain
- product CRUD
- media upload
- creative generation job UI
- campaign wizard
- calendar interactions
- approval actions
- social connection state
- analytics charts
- billing/usage screens
- team management
- notifications
- settings
- help/support.
