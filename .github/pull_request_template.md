## What this changes

<!-- The user-visible outcome, not the file list. "You are no longer charged
     for a generation that failed" rather than "refactored the credit ledger". -->

## Why

<!-- The problem. If this fixes something that was wrong, say what was wrong
     and how it could be reached — that is what a reviewer needs to judge the
     fix, and it is what the changelog entry will be written from. -->

## How it was verified

<!-- What you actually ran, and what it returned. Not "tested locally". -->

- [ ] `npm run verify` passes (type-check, lint, contrast, tests, build, bundle scan)
- [ ] New behaviour has a test that fails without the change
- [ ] Database changes are in a NEW migration file and are idempotent
- [ ] Tested against a real database / browser where the change warrants it

## Risk

<!-- What breaks if this is wrong, and how it is noticed. "Nothing" is a valid
     answer for a docs change and a suspicious one for anything else. -->

## Checklist

- [ ] No secrets, keys or tokens in the diff or in test fixtures
- [ ] No destructive change to an existing table; nothing applied to a live database
- [ ] Anything unfinished is behind a flag or hidden — no button that does nothing
- [ ] Claims added to user-facing copy are factual and checkable
- [ ] `FIXES.md` / `ROADMAP.md` updated if this changes what is true about the product
