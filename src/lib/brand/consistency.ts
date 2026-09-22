import type { BrandBrain } from '@/lib/brand/schema';
import { screenGeneratedCopy, type FactualityFinding } from '@/lib/brand/guard';

/**
 * The brand-consistency check.
 *
 * This is the feature the product's name is a promise about. A generator that
 * happens to read a brand description is a wrapper; something that can look at
 * arbitrary copy — pasted from an agency, an intern, a previous tool — and say
 * specifically where it departs from the brand is a different product.
 *
 * ## Deterministic first, AI second
 *
 * Every check here is countable and reproducible: a word from the avoid list,
 * a sentence over the length the brand's own rules set, a forbidden claim. No
 * model is called. That matters for three reasons and they are all product
 * reasons, not technical ones:
 *
 *  1. **It is free**, so it can run on every keystroke-adjacent action without
 *     a credit dialog, and a user can check a hundred captions.
 *  2. **It is explainable.** Every point deducted names the exact excerpt that
 *     caused it. A model returning "82% on brand" is unfalsifiable and
 *     therefore unactionable — nobody can fix an opinion.
 *  3. **It is stable.** The same copy scores the same tomorrow. A score that
 *     drifts between runs teaches people to ignore it.
 *
 * A model can add a voice judgement on top, and the route offers that
 * separately and says it costs a credit. It is an addition to this, never a
 * replacement for it.
 *
 * ## The score is a floor, not a verdict
 *
 * 100 does not mean "on brand" — it means nothing checkable is wrong. That is
 * stated in the result and rendered in the UI, because a green tick that
 * people read as approval is worse than no score at all.
 */

export type FindingSeverity = 'blocker' | 'warning' | 'suggestion';

export interface ConsistencyFinding {
  severity: FindingSeverity;
  /** Machine-readable, so the UI can group without parsing prose. */
  category:
    | 'avoided_word'
    | 'forbidden_claim'
    | 'sentence_length'
    | 'missing_preferred'
    | 'dont_rule'
    | 'reading_level'
    | 'exclamation'
    | 'hedging';
  /** The exact text that triggered it. Never a paraphrase. */
  excerpt: string;
  message: string;
  /** What to do instead, when there is a specific answer. */
  suggestion?: string;
}

export interface ConsistencyResult {
  /** 0–100. Derived, explainable, and explicitly not a verdict. */
  score: number;
  findings: ConsistencyFinding[];
  /** Counts by severity, so a UI does not have to reduce the list itself. */
  summary: { blockers: number; warnings: number; suggestions: number };
  /**
   * What was actually checked. Null entries mean the brand has not defined
   * that rule — reported as unchecked rather than as passed, so a brand with
   * an empty voice section does not score 100 and look verified.
   */
  checked: {
    avoidedWords: number | null;
    preferredWords: number | null;
    dontRules: number | null;
    maxSentenceWords: number | null;
    forbiddenClaims: true;
  };
  /** Plain-language caveat, carried with the result so it cannot be dropped. */
  caveat: string;
}

/** Severity weights. Blockers dominate; suggestions barely move the number. */
const WEIGHT: Record<FindingSeverity, number> = {
  blocker: 25,
  warning: 8,
  suggestion: 2,
};

const CAVEAT =
  'A score of 100 means nothing checkable is wrong — not that the copy is on brand. These checks catch banned words, unsupported claims and rule violations. They cannot judge whether the writing is any good.';

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Finds a whole-word occurrence, case-insensitively.
 *
 * Whole-word matters more than it looks: an avoid list containing "AI" would
 * otherwise fire on "said", "maintain" and "chair", and a check that produces
 * three false positives per paragraph gets switched off on day one.
 */
function findWord(text: string, term: string): string | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  const match = text.match(pattern);
  if (!match || match.index === undefined) return null;

  // Return the surrounding clause, not the bare word: "utilise" on its own
  // tells the writer nothing about where to look in a 300-word caption.
  const start = Math.max(0, match.index - 40);
  const end = Math.min(text.length, match.index + term.length + 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Reads a maximum sentence length out of the brand's own writing rules.
 *
 * Only applied when the brand actually stated one. Imposing a default
 * sentence limit would be this product inventing a style opinion and
 * attributing it to the customer's brand, which is exactly the failure the
 * Brand Brain exists to prevent.
 */
function maxSentenceWords(brain: BrandBrain): number | null {
  const rules = brain.voice?.writingRules ?? [];
  for (const rule of rules) {
    const match = rule.match(/(?:under|below|max(?:imum)?|no more than|fewer than)\s+(\d{1,3})\s*words?/i);
    if (match) {
      const limit = Number(match[1]);
      if (limit >= 3 && limit <= 200) return limit;
    }
  }
  return null;
}

export function checkConsistency(text: string, brain: BrandBrain): ConsistencyResult {
  const findings: ConsistencyFinding[] = [];

  const avoided = brain.voice?.avoidedWords ?? [];
  const preferred = brain.voice?.preferredWords ?? [];
  const dontRules = brain.guidelines?.dontRules ?? [];
  const sentenceLimit = maxSentenceWords(brain);

  /* --- 1. Words the brand has banned ------------------------------------ */
  for (const term of avoided) {
    const excerpt = findWord(text, term);
    if (excerpt) {
      findings.push({
        severity: 'blocker',
        category: 'avoided_word',
        excerpt,
        message: `“${term}” is on this brand’s avoid list.`,
        suggestion: preferred.length > 0 ? `Preferred instead: ${preferred.slice(0, 5).join(', ')}.` : undefined,
      });
    }
  }

  /* --- 2. Claims the product must never make ---------------------------- */
  /*
   * Reuses the factuality guard rather than restating its patterns. Two copies
   * of "what counts as a medical claim" is how one of them silently falls
   * behind, and the one that falls behind is always the one nobody is testing.
   */
  const factuality: FactualityFinding[] = screenGeneratedCopy(text, {
    brandBrain: brain,
    /*
     * No approved facts are supplied, which is the right call rather than a
     * shortcut. This check runs on arbitrary pasted copy that is not tied to
     * a product, so there is no fact set it belongs to — and passing the
     * wrong product's facts would either wave through an unsupported claim or
     * flag a true one. The categorical checks (medical claims, guarantees,
     * absolutes) do not depend on a fact set and are the ones that apply here.
     */
    approvedFacts: { facts: [], numbers: [] },
  });

  for (const finding of factuality) {
    findings.push({
      severity: finding.severity === 'block' ? 'blocker' : 'warning',
      category: 'forbidden_claim',
      excerpt: finding.excerpt,
      message: finding.explanation,
    });
  }

  /* --- 3. The brand's own "never do this" rules ------------------------- */
  for (const rule of dontRules) {
    /*
     * Rules are prose, so this matches on the distinctive nouns in them
     * rather than pretending to understand the rule. Deliberately a
     * SUGGESTION, never a blocker: the match is a heuristic, and blocking on
     * a heuristic reading of a sentence is how a tool loses trust.
     */
    const keyTerms = rule
      .toLowerCase()
      .replace(/^(never|don'?t|do not|avoid)\s+/i, '')
      .split(/\s+/)
      .filter((word) => word.length > 5 && !/^(should|would|because|through|always)$/.test(word));

    const hit = keyTerms.find((term) => findWord(text, term) !== null);
    if (hit) {
      findings.push({
        severity: 'suggestion',
        category: 'dont_rule',
        excerpt: findWord(text, hit) ?? hit,
        message: `Possibly touches a brand rule: “${rule}”`,
        suggestion: 'Worth a read — this is a keyword match, not an understanding of the rule.',
      });
    }
  }

  /* --- 4. Sentence length, only if the brand set a limit ---------------- */
  if (sentenceLimit !== null) {
    for (const sentence of sentences(text)) {
      const count = words(sentence).length;
      if (count > sentenceLimit) {
        findings.push({
          severity: 'warning',
          category: 'sentence_length',
          excerpt: sentence.length > 120 ? `${sentence.slice(0, 120)}…` : sentence,
          message: `${count} words. This brand's rules say under ${sentenceLimit}.`,
        });
      }
    }
  }

  /* --- 5. Preferred vocabulary ------------------------------------------ */
  if (preferred.length > 0 && words(text).length >= 25) {
    const used = preferred.filter((term) => findWord(text, term) !== null);
    if (used.length === 0) {
      findings.push({
        severity: 'suggestion',
        category: 'missing_preferred',
        // The whole text is the excerpt: the finding is about an absence, and
        // pointing at a specific place would be inventing a location.
        excerpt: text.slice(0, 80).trim() + (text.length > 80 ? '…' : ''),
        message: 'None of this brand’s preferred words appear.',
        suggestion: `Consider: ${preferred.slice(0, 6).join(', ')}.`,
      });
    }
  }

  /* --- 6. Two style tells worth flagging regardless --------------------- */
  const exclamations = (text.match(/!/g) ?? []).length;
  if (exclamations >= 3) {
    findings.push({
      severity: 'suggestion',
      category: 'exclamation',
      excerpt: `${exclamations} exclamation marks`,
      message: 'Heavy exclamation use reads as hype rather than confidence.',
    });
  }

  const hedges = ['maybe', 'perhaps', 'sort of', 'kind of', 'we think', 'possibly', 'somewhat'];
  const hedgeHit = hedges.map((hedge) => findWord(text, hedge)).find(Boolean);
  if (hedgeHit) {
    findings.push({
      severity: 'suggestion',
      category: 'hedging',
      excerpt: hedgeHit,
      message: 'Hedging weakens a claim you are otherwise entitled to make.',
    });
  }

  /* --- Score ------------------------------------------------------------ */
  const deduction = findings.reduce((total, finding) => total + WEIGHT[finding.severity], 0);
  const score = Math.max(0, 100 - deduction);

  return {
    score,
    findings,
    summary: {
      blockers: findings.filter((f) => f.severity === 'blocker').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      suggestions: findings.filter((f) => f.severity === 'suggestion').length,
    },
    checked: {
      // Null, not zero, where the brand defined no rule. Zero would read as
      // "checked, nothing banned" when the truth is "nothing to check against".
      avoidedWords: avoided.length > 0 ? avoided.length : null,
      preferredWords: preferred.length > 0 ? preferred.length : null,
      dontRules: dontRules.length > 0 ? dontRules.length : null,
      maxSentenceWords: sentenceLimit,
      forbiddenClaims: true,
    },
    caveat: CAVEAT,
  };
}

/**
 * How much of the brand is actually defined, as a fraction.
 *
 * Shown next to the score so a thin Brand Brain cannot produce a confident
 * 100. A user whose brand has no avoid list and no rules is being told "we
 * checked four things and found nothing", and the honest version of that
 * sentence includes how few things there were to check.
 */
export function coverage(brain: BrandBrain): { defined: number; total: number } {
  const signals = [
    (brain.voice?.avoidedWords ?? []).length > 0,
    (brain.voice?.preferredWords ?? []).length > 0,
    (brain.voice?.writingRules ?? []).length > 0,
    (brain.guidelines?.dontRules ?? []).length > 0,
    (brain.voice?.tone ?? []).length > 0,
  ];
  return { defined: signals.filter(Boolean).length, total: signals.length };
}
