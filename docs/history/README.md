# Historical planning documents

**These describe intentions, not the current code. Do not treat them as
documentation.**

They were written before and during the build and have been superseded. Several
contradict the shipped implementation outright — `PHASE_2_SETUP.md` routes every
AI call through `src/lib/gemini.ts`, which no longer exists;
`PHASE_1_DESIGN_SYSTEM.md` specifies the cream-and-coral editorial palette that
the indigo token system replaced; more than one lists as "pending" work that was
finished, and as "done" work that never started.

They are kept because they record _why_ decisions were taken, which a diff
cannot show. They are moved out of the repository root because twenty markdown
files competing with `README.md` is how a reader ends up trusting the wrong one.

## What to read instead

| Question                                  | File                                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| What is this and how do I run it?         | [`../../README.md`](../../README.md)                          |
| What is real and what is not?             | [`../../README.md`](../../README.md) — "What is not real yet" |
| Known issues, ranked, with status         | [`../../AUDIT.md`](../../AUDIT.md)                            |
| What changed and what you must do by hand | [`../../FIXES.md`](../../FIXES.md)                            |
| What is planned next, ranked              | [`../../ROADMAP.md`](../../ROADMAP.md)                        |
| How do I deploy it?                       | [`../DEPLOY_VERCEL.md`](../DEPLOY_VERCEL.md)                  |
| How is the database schema applied?       | `supabase/migrations/` in filename order                      |
