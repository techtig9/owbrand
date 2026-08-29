# OwBrand Phase 9 — Production Hardening & Launch

Added: rate-limit contract, security-header helper, health/readiness endpoints, launch checklist and production environment template.

Before charging customers, complete real deployment configuration: authentication, tenant RLS tests, OAuth approvals, billing webhooks, distributed rate limiting, backups/restore, queues, monitoring, error tracking, CI tests, and end-to-end onboarding/publishing tests.

Required CI: lint → typecheck → unit tests → integration tests → build.

Production navigation target: Dashboard, Brand Brain, Products, Creative Studio, AI Campaigns, Content Calendar, Social Accounts, Publishing Queue, Analytics, AI Recommendations, Team, Billing, Notifications, Help & Support, Settings.

Core onboarding: business description → Brand Brain → first product → upload photos → AI shoot → first creative → approval → scheduling → analytics.
