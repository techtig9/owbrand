# Phase 1 — Audit + Design System

Source specs merged for this phase:
- `OWBRAND_MASTER_CLAUDE_BUILD_PROMPT.md` (uploaded), primarily §3–§7 (visual direction,
  color, typography, shape, animation) and §10 (landing page copy/CTA).
- The uploaded Figma "Free Agency Template" screenshot + community link — used as a
  **structural/pattern reference only** (hero composition, a "trusted by" logo strip under
  the hero, clean nav with a single pill CTA, light/dark-capable neutral base with one
  dominant accent). Its specific layout, wordmark, exact type and asset choices were not
  copied, per the master prompt's own §3 instruction not to copy a reference's proprietary
  identity, and per standard copyright practice.

## Assumption (stated, not blocking)
The existing codebase's palette (`canvas`/`ink`/`coral`/`blush`/`mint`/`lavender`) already
satisfies the master prompt's §4 base ("warm cream/off-white, deep charcoal text") and its
`coral` accent already fills the "orange/signature" role the Figma reference also uses. Rather
than rewrite the palette (`coral` alone is referenced in 20+ files; `ink`/`canvas` in 60+), this
phase **added** the fuller bold-accent set (`pink`, `sun`, `fresh`, `cyan`, `cobalt`, `violet`)
as new, additive tokens for later per-context use, and left every existing token and its
current usages untouched. This keeps the app runnable and avoids an app-wide rewrite that
wasn't requested yet.

## What changed
- `tailwind.config.ts` — added the §4 bold accent palette (`pink`, `sun`, `fresh`, `cyan`,
  `cobalt`, `violet`) as new tokens, additive only.
- `src/app/globals.css` — added `.reveal-scale` (opacity 0→1, scale 0.98→1 card entrance per
  §7) and `.trust-logo` (neutral-until-hover partner-logo treatment).
- `src/components/landing/Navbar.tsx` — added the `✦` mark from §9 ("OWBRAND ✦"), CTA button
  now uses the signature accent pill (`btn-accent`) instead of the neutral pill.
- `src/components/landing/Hero.tsx` — headline, subheading and primary CTA now match §10
  exactly ("Build a brand from one idea." / the upload→brand→content→campaigns subheading /
  "Create your brand ✦").
- `src/components/landing/TrustedBy.tsx` (new) — the Figma-referenced "trusted by" strip
  placed directly under the hero. Shows owbrand's real infrastructure partners (Supabase,
  Google Gemini, Paddle, Resend, Next.js) rather than invented customer names/logos, per
  §44/§61 ("never present fabricated ... as real").
- `src/app/page.tsx` — wired `<TrustedBy />` in.
- Fixed 4 pre-existing `tsc --noEmit` errors unrelated to this phase's scope (found during
  audit): a `.catch()` on a non-thenable Supabase RPC builder in
  `api/ai/build-brand/route.ts`, a stale `@ts-expect-error` in `PlanGrid.tsx`, missing
  `video`/`ad` entries in `lib/prompts/content.ts`'s `ASSET_SYSTEM_PROMPTS` map, and an
  invalid `null as const` in `lib/require-admin.ts`.

## Explicitly deferred (tracked, not dropped)
- §10's "main animated story" strip (business → brand → product → photo → shoot → post →
  reel → ad → calendar → analytics) and end statement ("One product. An entire brand
  system.") — this needs the Product Brain/Campaign concepts that land in Phases 2–3 below;
  writing it now would be decorative copy for features that don't exist yet.
- `AIDemo.tsx` still demos the older "sentence → website" flow. Revisit alongside Product
  Brain/Creative Studio (Phase 2–3) so it demos real capability.
- Propagating the new bold-accent tokens into the in-app dashboard (not just marketing
  pages) — left for the phase that touches those surfaces, to keep this phase's diff scoped
  and reviewable.
- Before/after slider, generation-progress component, Creative Studio 3-pane layout (§8, §17)
  — Phase 3 below.

## How this was tested
- `npx tsc --noEmit` — clean (0 errors) with `strict: true`, before and after.
- `npm run build` — this sandbox has no network access to `fonts.googleapis.com`
  (`next/font` fetches Bricolage Grotesque + Inter at build time), so a full production
  build can't complete *in this environment*. That failure is unrelated to this phase's
  code changes — it's present on a clean, unmodified checkout too. Please run `npm run
  build` once in an environment with normal internet access (or push to Vercel) to get a
  full build confirmation before this ships; flag it back to me if anything fails there.
- Manual review of every touched file for unused imports/dead code.
