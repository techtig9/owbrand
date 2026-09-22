'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, Textarea } from '@/components/ui';

interface Finding {
  severity: 'blocker' | 'warning' | 'suggestion';
  category: string;
  excerpt: string;
  message: string;
  suggestion?: string;
}

interface Result {
  score: number;
  findings: Finding[];
  summary: { blockers: number; warnings: number; suggestions: number };
  coverage: { defined: number; total: number };
  caveat: string;
}

/**
 * The consistency checker.
 *
 * Three presentation decisions carry most of the weight:
 *
 *  - **The caveat sits next to the score, not in a tooltip.** A number in a
 *    big font is read as a verdict, and the whole design problem here is that
 *    100 means "nothing checkable is wrong", not "this is on brand". Hiding
 *    that behind a hover would be technically honest and practically a lie.
 *  - **Coverage is shown beside the score, always.** A confident 100 from a
 *    brand with no avoid list and no rules is the most misleading thing this
 *    feature could output, so the number never appears without how much there
 *    was to check against.
 *  - **Findings quote the exact text.** "Tone issues detected" cannot be
 *    acted on. A quoted clause with the rule it breaks is fixed in seconds.
 */
export function ConsistencyCheck({ brandId }: { brandId: string }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    if (loading || text.trim().length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/brand/consistency', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandId, text }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? 'Could not check that copy.');
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check that copy.');
    } finally {
      setLoading(false);
    }
  }

  const tone =
    result && result.summary.blockers > 0 ? 'danger' : result && result.score < 90 ? 'warning' : 'success';

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-content">Check copy against this brand</h2>
      <p className="mt-1 text-sm leading-6 text-content-secondary">
        Paste anything — a caption, an email, a page someone else wrote. Checks banned words, claims
        this brand must not make, and the writing rules you set. Free, and no AI call.
      </p>

      <div className="mt-5">
        <Textarea
          label="Copy to check"
          hint="Up to 20,000 characters."
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          maxLength={20000}
          placeholder="Every piece is hand-thrown in our studio…"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          loading={loading}
          disabled={text.trim().length === 0}
          onClick={() => void check()}
          icon={<ShieldCheck className="h-4 w-4" />}
        >
          Check consistency
        </Button>
        <span className="text-xs text-content-tertiary">No credits used</span>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-danger-subtle px-3 py-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-6 animate-fade-in border-t border-[color:var(--color-border)] pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums text-content">{result.score}</span>
              <span className="text-sm text-content-tertiary">/ 100</span>
            </div>
            <Badge tone={tone}>
              {result.summary.blockers > 0
                ? `${result.summary.blockers} blocker${result.summary.blockers === 1 ? '' : 's'}`
                : result.findings.length === 0
                  ? 'Nothing flagged'
                  : `${result.findings.length} to review`}
            </Badge>
            {/* Always shown. 100 next to "1 of 5 rules" reads very differently
                from 100 next to "5 of 5", and it should. */}
            <span className="text-xs text-content-tertiary">
              Checked against {result.coverage.defined} of {result.coverage.total} brand rules
            </span>
          </div>

          <p className="mt-3 max-w-2xl text-xs leading-5 text-content-tertiary">{result.caveat}</p>

          {result.coverage.defined < 3 && (
            <p className="mt-3 rounded-md bg-surface-raised px-3 py-2 text-xs leading-5 text-content-secondary">
              This brand defines few rules, so there is little to check against. Adding an avoid
              list and a few writing rules to the Brand Brain is what makes this useful.
            </p>
          )}

          {result.findings.length === 0 ? (
            <p className="mt-5 flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              No banned words, forbidden claims or rule violations found.
            </p>
          ) : (
            <ul className="mt-5 space-y-3">
              {(['blocker', 'warning', 'suggestion'] as const).flatMap((severity) =>
                result.findings
                  .filter((finding) => finding.severity === severity)
                  .map((finding, index) => (
                    <li
                      key={`${severity}-${index}`}
                      className={`rounded-xl border p-4 ${
                        severity === 'blocker'
                          ? 'border-danger bg-danger-subtle'
                          : severity === 'warning'
                            ? 'border-[color:var(--color-border-strong)]'
                            : 'border-[color:var(--color-border)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {severity === 'blocker' ? (
                          <AlertTriangle className="h-4 w-4 text-danger" aria-hidden="true" />
                        ) : (
                          <Info className="h-4 w-4 text-content-tertiary" aria-hidden="true" />
                        )}
                        {/* The severity is a word, not only a colour. */}
                        <Badge
                          tone={
                            severity === 'blocker' ? 'danger' : severity === 'warning' ? 'warning' : 'neutral'
                          }
                        >
                          {severity}
                        </Badge>
                        <span className="text-xs text-content-tertiary">
                          {finding.category.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <p className="mt-2 text-sm font-medium text-content">{finding.message}</p>

                      {/* The exact text, so the fix takes seconds. */}
                      <blockquote className="mt-2 border-l-2 border-[color:var(--color-border-strong)] pl-3 text-sm italic leading-6 text-content-secondary">
                        {finding.excerpt}
                      </blockquote>

                      {finding.suggestion && (
                        <p className="mt-2 text-xs leading-5 text-content-tertiary">{finding.suggestion}</p>
                      )}
                    </li>
                  ))
              )}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
