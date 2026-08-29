# OwBrand Phase 6 — Production Execution Layer

Phase 6 connects the planning/orchestration architecture to safe execution boundaries.

## Added

- Publishing worker boundary
- Provider registry contract
- Idempotent publishing execution
- Media validation
- Marketing execution endpoint
- OAuth connection metadata schema
- Server-side secret references
- Execution audit log
- Worker heartbeat table

## Critical production rule

The browser never receives a social access/refresh token.

OAuth flow:

Browser
→ provider authorization
→ server callback
→ encrypted secret storage
→ `token_secret_ref`
→ publishing worker
→ official provider API

## Worker behavior

A production worker should:

1. Claim one queued job transactionally.
2. Check the approval/automation policy.
3. Validate media.
4. Resolve the server-side token reference.
5. Call the platform adapter.
6. Save the external post ID/URL.
7. Mark the job completed.
8. Retry transient failures with exponential backoff.
9. Move permanent failures to a dead-letter state.
10. Write an audit event.

## Platform adapters

Implement official APIs separately for each platform that supports the required publishing operation. Never scrape websites or automate consumer UIs.

## What remains provider-specific

Actual OAuth credentials, redirect URLs, app-review status, publishing scopes, media constraints and rate limits differ by platform and must be configured from each platform's current official developer documentation.

## Phase 7 target

Build the analytics ingestion and AI optimization layer on top of these real execution events:
publishing → metrics → attribution → recommendations → new campaign actions.
