# OwBrand Final Launch Checklist

## P0 — Must pass before charging customers
- [ ] Production database configured
- [ ] Tenant RLS policies installed and tested
- [ ] Authentication tested
- [ ] Workspace authorization tested
- [ ] Secrets removed from source control
- [ ] Production object storage configured
- [ ] AI provider configured
- [ ] Generation workers configured
- [ ] Social provider OAuth apps configured/approved
- [ ] Publishing workers tested
- [ ] Billing provider configured
- [ ] Billing webhooks signature-verified and idempotent
- [ ] Usage limits enforced server-side
- [ ] Backups enabled
- [ ] Restore test completed
- [ ] Error monitoring enabled
- [ ] Rate limiting enabled with shared storage
- [ ] Audit logging enabled
- [ ] Privacy/terms/support contact configured
- [ ] End-to-end golden-path test passes

## P1 — Strongly recommended
- [ ] Load testing
- [ ] Queue-depth alerts
- [ ] Provider failure alerts
- [ ] Automated dependency health checks
- [ ] Email notifications
- [ ] In-app notifications
- [ ] Admin operations dashboard
- [ ] Customer export/delete workflow
- [ ] Data retention policy
- [ ] Abuse/spam controls
- [ ] AI cost monitoring
- [ ] Per-workspace AI budget controls

## Golden-path acceptance test

Create workspace
→ create brand
→ add product
→ upload ordinary photos
→ approve facts
→ generate image
→ generate short video/ad
→ create campaign
→ approve
→ schedule
→ publish
→ receive analytics
→ generate recommendation

The test is successful only when the final recommendation is based on stored analytics rather than mock data.
