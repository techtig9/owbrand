/**
 * Legal page content.
 *
 * ⚠️ THESE ARE DRAFTS. Every page renders a prominent notice saying so, and
 * that notice is not removable from the content side — it is rendered by the
 * page component, so a draft cannot be published as final by editing this file
 * alone.
 *
 * Written as structured data rather than prose files because the *structure*
 * is the part a lawyer reviews: which disclosures exist, what each one covers,
 * and what is deliberately omitted. A wall of boilerplate hides all three.
 *
 * Every factual claim here is checkable against the code. Where the product
 * does something a policy would normally gloss over — provider tokens being
 * encrypted with a key the operator holds, AI output not being used for
 * training by us because we do not train — it says so specifically.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
  /** Rendered as a list under the paragraphs. */
  bullets?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  description: string;
  /** What a reader should take away in one sentence, before the detail. */
  summary: string;
  lastReviewed: string;
  sections: LegalSection[];
  /**
   * What this document deliberately does NOT cover. Stating the gaps is the
   * most useful thing a draft can do for the lawyer who reviews it.
   */
  gaps: string[];
}

const OPERATOR = 'Techtig';
const PRODUCT = 'owbrand';

export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  privacy: {
    slug: 'privacy',
    title: 'Privacy',
    description: `What ${PRODUCT} stores, why, and how to get it deleted.`,
    summary:
      'We store the brand and product information you enter, what you generate from it, and metrics we fetch from platforms you connect. We do not sell it, and we do not train models on it.',
    lastReviewed: '2026-09-22',
    sections: [
      {
        heading: 'What we store',
        paragraphs: [
          'Only what the product needs to function. Each item below corresponds to a table in the database rather than to a category invented for this page.',
        ],
        bullets: [
          'Account: your email address, name, and authentication state, held by Supabase Auth.',
          'Brand and product data: the descriptions you write, the Brand Brain generated from them, and the product facts you approve.',
          'Generated content: the copy, captions and creative briefs produced for you, and the factuality findings raised against them.',
          'Connected accounts: an encrypted access token per connected social account, plus the account name and id the platform returns.',
          'Analytics: metrics fetched from platforms you connect, at the daily and per-post level.',
          'Billing: a customer and subscription identifier from Paddle. We never see or store your card details.',
          'Operational logs: request identifiers, route names, error classes and timings. Log lines are written without your content in them.',
        ],
      },
      {
        heading: 'Provider tokens',
        paragraphs: [
          'Access tokens for connected social accounts are encrypted at rest with AES-256-GCM before they are written, using a key held in the deployment environment and never in the database. The ciphertext is bound to the row it belongs to, so a token copied into a different row cannot be decrypted.',
          'If the operator rotates that key, every stored token becomes unreadable and each account reports that it needs reconnecting. That is the intended behaviour: the alternative is a key that can never be rotated.',
        ],
      },
      {
        heading: 'What we do not do',
        paragraphs: [],
        bullets: [
          `We do not sell your data, and ${OPERATOR} does not share it with advertisers.`,
          'We do not train models. Your content is sent to the AI providers listed in the subprocessors page to fulfil your request, and is not used by us to train anything.',
          'We do not post to your connected accounts except when you schedule or publish something.',
        ],
      },
      {
        heading: 'Deleting your data',
        paragraphs: [
          'You can request deletion of your account and its data from the account settings page. Deletion removes your brands, products, generated content, connected-account tokens and analytics.',
          'Two things survive, and both are deliberate: billing records we are required to retain for tax and accounting purposes, and aggregate counters that contain no reference to you.',
        ],
      },
      {
        heading: 'Where your data is processed',
        paragraphs: [
          'Hosting and database are provided by Vercel and Supabase; AI generation by the providers listed on the subprocessors page. Processing regions depend on the operator’s configuration of those services.',
        ],
      },
    ],
    gaps: [
      'No jurisdiction is named, and no controller or processor role is assigned. A lawyer needs to set both.',
      'Retention periods are described qualitatively, not in months. Real numbers are needed per table.',
      'GDPR and CCPA rights are not enumerated. If either applies, this document must list the specific rights and the response window.',
      'No data protection officer or representative is named.',
      'Cookie use is described on a separate page only if analytics are enabled; that page does not exist while no analytics provider is configured.',
    ],
  },

  terms: {
    slug: 'terms',
    title: 'Terms of service',
    description: `The agreement between you and ${OPERATOR} for using ${PRODUCT}.`,
    summary:
      'You own what you generate. We provide the service as-is, meter it in credits, and can suspend accounts that abuse it. AI output can be wrong and you are responsible for what you publish.',
    lastReviewed: '2026-09-22',
    sections: [
      {
        heading: 'Who owns the output',
        paragraphs: [
          'You do. Content generated for your account is yours to use commercially, modify and publish.',
          `${OPERATOR} claims no ownership of your brand information or of anything produced from it. Free-plan accounts carry a small "Made with ${PRODUCT}" attribution on outputs that are shared or published; paid plans do not.`,
        ],
      },
      {
        heading: 'What you are responsible for',
        paragraphs: [
          'Everything you publish. The product includes a factuality guard that blocks copy asserting claims your approved facts do not support, and that guard reduces mistakes — it does not eliminate them, and it cannot know what is true about your business beyond what you have entered.',
        ],
        bullets: [
          'Checking generated claims before publishing them, particularly anything about safety, health, certification or price.',
          'Having the rights to the material you upload.',
          'Complying with the terms of any platform you connect, including Meta’s.',
        ],
      },
      {
        heading: 'Credits and billing',
        paragraphs: [
          'Usage is metered in credits. Credits are reserved before a generation runs and refunded automatically if it fails, times out, or returns output that fails validation — you are not charged for a generation you did not receive.',
          'Monthly credits do not roll over. Billing is handled by Paddle as merchant of record.',
        ],
      },
      {
        heading: 'What we do not promise',
        paragraphs: [
          'The service is provided as-is. We do not warrant that generated content is accurate, that a connected platform will accept a post, or that the service will be uninterrupted.',
          'Specific features are explicitly incomplete and are listed as such on the product pages. Nothing on this site should be read as a commitment to ship them.',
        ],
      },
      {
        heading: 'Suspension',
        paragraphs: [
          'We may suspend an account for attempting to circumvent credit limits or rate limits, for abusing the referral programme, or for generating content that is unlawful.',
        ],
      },
    ],
    gaps: [
      'No governing law, jurisdiction or dispute-resolution mechanism. A lawyer must set these.',
      'No liability cap and no indemnity clauses.',
      'No notice period or process for changing these terms.',
      'No service-level commitment, which is consistent with the as-is position but should be stated deliberately rather than by omission.',
      'The suspension section has no appeal process.',
    ],
  },

  refund: {
    slug: 'refund',
    title: 'Refunds',
    description: 'When we refund, and when we do not.',
    summary:
      'Credits for failed generations are refunded automatically and immediately. Subscription refunds are handled case by case through Paddle.',
    lastReviewed: '2026-09-22',
    sections: [
      {
        heading: 'Automatic credit refunds',
        paragraphs: [
          'These need no request and are not a goodwill gesture — they are how the credit system works. A generation that errors, times out, or produces output failing schema validation has its credit reservation released automatically.',
          'If you believe you were charged credits for something you did not receive, the credit ledger on your billing page shows every reservation and refund with a reason.',
        ],
      },
      {
        heading: 'Subscription refunds',
        paragraphs: [
          'Paddle is the merchant of record, so subscription refunds are issued through Paddle and follow their process.',
          'We will support a refund request where the service did not work as described, where a renewal was unintentional and unused, or where a feature you subscribed for turns out to be one of the incomplete ones listed on the product pages.',
        ],
      },
      {
        heading: 'What we will not refund',
        paragraphs: [
          'Credits consumed by generations that completed successfully, including ones whose output you did not like. Generation costs us money per call whether or not the result suits you.',
        ],
      },
    ],
    gaps: [
      'No stated refund window. A lawyer should set one, and it must satisfy consumer law in every jurisdiction where the product is sold.',
      'No mention of statutory cooling-off rights, which are mandatory in the EU and UK for consumer purchases.',
      'Pro-rata treatment of mid-period cancellations is not specified.',
    ],
  },

  'ai-use': {
    slug: 'ai-use',
    title: 'How we use AI',
    description:
      'Which models see your content, what they are asked to do, and what the product refuses to do.',
    summary:
      'Your brand and product information is sent to an AI provider to fulfil each request. We do not train on it. Generated content is checked against the facts you have approved before it can be published.',
    lastReviewed: '2026-09-22',
    sections: [
      {
        heading: 'What is sent, and when',
        paragraphs: [
          'Nothing is sent to an AI provider except to fulfil a request you made. Each call carries the brand and product information relevant to that request, and the instruction for that task.',
          'Requests are not batched across accounts, and one account’s content is never included in another account’s prompt.',
        ],
      },
      {
        heading: 'Which providers',
        paragraphs: [
          'Claude is the primary provider, with Google Gemini as a configured fallback so a timeout or rate limit on one does not fail your request. Which providers are actually available depends on the API keys the operator has configured, and the product reports that rather than assuming.',
          'Both are listed on the subprocessors page. Neither is asked to use your content for training, and we do not train models ourselves.',
        ],
      },
      {
        heading: 'What the product refuses to do',
        paragraphs: ['These are enforced in code and in the database, not by asking a model to behave:'],
        bullets: [
          'Copy asserting a claim your approved product facts do not support is blocked and queued for review, with the exact excerpt that triggered it.',
          'A recommendation cannot be stored without the evidence it rests on — the database rejects an empty evidence set.',
          'An unmeasured metric is reported as absent rather than as zero, so no advice is derived from a number nobody collected.',
          'Testimonials and customer counts are never generated as though real; placeholder slots are typed such that a generated quote cannot be presented as genuine.',
        ],
      },
      {
        heading: 'AI output can be wrong',
        paragraphs: [
          'The guards above catch unsupported claims about your products. They cannot catch a claim that is well-formed, supported by a fact you entered incorrectly, or wrong about the world in some way the product has no way to check. Review anything you publish.',
        ],
      },
    ],
    gaps: [
      'No EU AI Act classification. If the product is offered in the EU, the transparency obligations need assessing.',
      'Provider data-processing terms are referenced but not incorporated by reference with versions and dates.',
      'No statement on human review of automated decisions, which matters if credit suspension is ever automated.',
    ],
  },

  subprocessors: {
    slug: 'subprocessors',
    title: 'Subprocessors',
    description: 'The third parties that process data on our behalf.',
    summary: 'Six services, each with what it handles and why.',
    lastReviewed: '2026-09-22',
    sections: [
      {
        heading: 'Current subprocessors',
        paragraphs: [
          'A service appears here when it can see customer data. Ones that are configured per deployment are marked, because a self-hosted deployment may not use them at all.',
        ],
        bullets: [
          'Supabase — database, authentication and file storage. Sees all stored account and brand data.',
          'Vercel — application hosting. Sees requests in transit and operational logs.',
          'Anthropic (Claude) — AI generation. Sees the brand and product information included in each request.',
          'Google (Gemini) — AI generation fallback. Same scope as above, used when configured.',
          'Paddle — merchant of record for billing. Sees your billing details; we do not.',
          'Resend — transactional email. Sees your email address and the contents of notifications sent to you.',
          'Upstash — rate-limit counters. Sees hashed identifiers, not content. Configured per deployment.',
          'Meta — only for accounts you explicitly connect, and only to read metrics and publish what you schedule.',
        ],
      },
      {
        heading: 'Changes',
        paragraphs: [
          'This page is the record. There is no subscription mechanism for changes to it yet, which is listed as a gap below rather than described as one.',
        ],
      },
    ],
    gaps: [
      'No notification mechanism for subprocessor changes, which some enterprise agreements require.',
      'No processing location or data-transfer mechanism stated per subprocessor.',
      'Data processing agreements with each subprocessor are not referenced by version.',
    ],
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL_DOCUMENTS);
