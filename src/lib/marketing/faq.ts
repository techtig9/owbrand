/**
 * The FAQ, extracted so the visible accordion and the FAQPage structured data
 * read the same strings.
 *
 * Structured data that does not match what a visitor sees is a Google
 * structured-data violation, and the usual cause is exactly this: two copies
 * that drift. One array cannot drift from itself.
 *
 * ---
 *
 * THREE OF THESE ANSWERS DESCRIBED FEATURES THAT DO NOT EXIST. They are
 * rewritten below, and the originals are recorded here because the failure is
 * worth remembering: a marketing page is the one place in a codebase where a
 * false claim has no compiler, no test and no reviewer, so it survives every
 * refactor that invalidates it.
 *
 *   1. "Google Gemini powers everything AI-related … Nothing else in owbrand
 *      calls an external AI service." — untrue since the provider abstraction
 *      landed. Claude is the primary provider; Gemini is a fallback.
 *
 *   2. "A lightweight compositing layer then assembles the transitions and
 *      animations into a short vertical clip." — there is no compositing
 *      layer. Reel *scripting* works; rendering is not built. This promised a
 *      deliverable the product cannot produce.
 *
 *   3. "every site … can be edited in the built-in code editor … or deployed
 *      straight to Vercel or Netlify." — there is no code editor (the Monaco
 *      dependency was removed as unused, having never been wired up), and both
 *      deploy routes return 503 because the adapters are not built.
 *
 * Every answer below is checkable against the code. Where something is not
 * built, it says so.
 */

export interface FaqEntry {
  question: string;
  answer: string;
}

export const FAQS: FaqEntry[] = [
  {
    question: 'Which AI models does owbrand use?',
    answer:
      'Claude is the primary provider, with Google Gemini as a configured fallback. Both sit behind one internal abstraction, so a timeout or rate limit on one falls through to the other rather than failing your request. Which providers are actually available depends on which API keys the operator has configured — the app reports that honestly rather than pretending a provider is present.',
  },
  {
    question: 'Are reels real AI-generated video?',
    answer:
      'No, and today they are not video at all. owbrand writes the reel script — the beats, the pacing, the order your existing photos should appear in — and that part works. Rendering that script into a finished clip is not built yet, so there is no file to download at the end. If you need finished video today, owbrand is not the tool for it.',
  },
  {
    question: 'What happens if a generation fails?',
    answer:
      'You are not charged. Credits are reserved before the provider is called and refunded automatically if the call errors, times out, or returns output that fails schema validation. The deduction is an atomic database operation, so two requests arriving at once cannot double-spend the same credits.',
  },
  {
    question: 'Can I export what I generate?',
    answer:
      'Site content exports as a ZIP. Two related things are honestly incomplete: the archive does not yet include generated section source, and one-click deployment to Vercel or Netlify is not built — those endpoints return an explicit "not available" rather than a deployment that silently never finishes. You can deploy the export yourself from your own hosting account.',
  },
  {
    question: 'Can owbrand publish to my social accounts?',
    answer:
      'Facebook Pages and Instagram business accounts, once the Meta app has been through App Review for the publishing permissions — that review takes Meta two to six weeks and nothing in owbrand can shorten it. Until it is granted, an account connects but reports that it needs reconnecting, and publishing is refused rather than queued into a void. TikTok, YouTube, LinkedIn, Pinterest and X are not supported; each says so specifically instead of accepting a post it cannot send.',
  },
  {
    question: 'Do unused credits roll over?',
    answer:
      'No. Monthly credits expire at the end of each billing cycle. Usage is metered in the dashboard against your plan so a limit is visible before you hit it, not after.',
  },
  {
    question: 'What does owbrand do differently?',
    answer:
      'It generates from a stored Brand Brain rather than from a fresh prompt each time, so the tenth post sounds like the first. It also refuses to invent: copy asserting a claim no approved product fact supports is blocked for review, an unmeasured metric is reported as absent rather than as zero, and a recommendation cannot be written without the evidence it rests on. Those are enforced in the database and the type system, not by prompt instructions.',
  },
];
