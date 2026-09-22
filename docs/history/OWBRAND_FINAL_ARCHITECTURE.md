# OwBrand — Final Product Architecture

## What OwBrand is

OwBrand is an AI brand operating system for businesses that starts from a business description and approved product information, builds a brand brain, creates product marketing assets from ordinary product photos, plans campaigns, schedules/publishes content, measures performance and continuously recommends improvements.

## Complete product modules

### 1. Brand Intelligence
- Business discovery
- Brand Brain
- brand identity
- positioning
- audience
- tone/voice
- visual system
- content pillars
- brand guardrails
- competitor/context inputs
- approved claims

### 2. Product Intelligence
- Product Brain
- product catalog
- variants
- pricing
- specifications
- inventory/availability inputs
- source photos
- approved facts
- product collections
- creative history

### 3. AI Creative Studio
- product photo cleanup
- background removal/replacement
- studio scenes
- lifestyle scenes
- multiple aspect ratios
- product hero shots
- carousel assets
- social posts
- short-form video
- reels
- ad creatives
- captions
- hooks
- CTAs
- variations
- versioning
- approval

### 4. Campaign OS
- objectives
- audience
- products
- offers
- channels
- content mix
- budget inputs
- scheduling
- automation policy
- approvals
- campaign lifecycle

### 5. Social Publishing
- OAuth connection management
- permission state
- publishing queue
- scheduling
- retry
- idempotency
- external post IDs
- provider errors
- account health

### 6. Analytics & Intelligence
- normalized metrics
- content performance
- platform performance
- campaign performance
- conversions
- revenue where supported
- attribution
- ROAS
- AI recommendations
- optimization feedback loop

### 7. SaaS Layer
- authentication
- workspaces
- teams
- roles
- subscriptions
- usage/credits
- billing
- notifications
- audit logs
- support

## AI safety/factuality

OwBrand must never invent customer reviews, product specifications, prices, certifications, guarantees or unsupported medical/legal/performance claims.

AI-generated creative must be based on approved product facts and brand rules.

## Automation levels

### Manual
AI suggests. User performs actions.

### Approval required
AI prepares and schedules. User approves before publishing.

### Assisted
AI may execute pre-approved routine actions within limits.

### Autonomous
Only permitted actions within explicit workspace policies, spend limits, platform permissions and safety rules may execute automatically.

High-risk or irreversible actions must remain approval-gated.

## Data boundaries

Customer tenant data must be isolated by workspace. Provider secrets remain server-side. Generated media should use private/signed storage where appropriate.

## The complete business loop

Business description
→ Brand Brain
→ Product Brain
→ Product photos
→ AI product shoot
→ Creative variations
→ Copy
→ Campaign
→ Approval
→ Schedule
→ Publish
→ Analytics
→ Attribution
→ AI recommendation
→ Improved campaign
→ Repeat

## What remains external

A repository cannot independently create third-party credentials, pass platform app review, open payment accounts, configure DNS, verify a business, or guarantee access to every platform's API.

Those are deployment/account tasks and must be completed with the actual provider accounts.

