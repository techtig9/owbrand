'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, X } from 'lucide-react';
import { Badge, Button, Card, Progress } from '@/components/ui';
import type { Checklist } from '@/lib/onboarding/steps';

/**
 * The activation checklist.
 *
 * Rendered from server-derived state — every step is a count of real rows, so
 * the list cannot claim a step is done for an account where it is not. See
 * `lib/onboarding/steps.ts` for why that matters.
 *
 * Presentation decisions worth stating:
 *
 *  - **An ordered list, and only ONE step is emphasised.** Highlighting every
 *    incomplete step is the same as highlighting none; the point of a
 *    checklist is to answer "what now" with one answer.
 *  - **Completed steps stay visible and stay linked.** Hiding them loses the
 *    sense of progress that makes a checklist work at all, and a user who
 *    ticked a step often wants to go back to it.
 *  - **Dismissing is optimistic but reversible.** The card disappears on click
 *    rather than after a round trip, because waiting on the network to dismiss
 *    something feels broken — and the request is fire-and-forget precisely
 *    because a failed dismiss is recoverable by dismissing again.
 */
export function OnboardingChecklist({ checklist, dismissed }: { checklist: Checklist; dismissed: boolean }) {
  const [hidden, setHidden] = useState(dismissed);

  // Nothing to show once everything is done: a checklist of ticks is clutter.
  if (hidden || checklist.finished) return null;

  async function dismiss() {
    setHidden(true);
    try {
      await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
    } catch {
      // Deliberately swallowed. The card is already gone for this session, and
      // the worst case is that it returns on the next visit — which is a far
      // better failure than an error toast about hiding a card.
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-content">Get to your first result</h2>
            {checklist.activated && <Badge tone="success">Activated</Badge>}
          </div>
          <p className="mt-1 text-sm leading-6 text-content-secondary">
            {checklist.activated
              ? 'The core loop works on your account. The rest is publishing.'
              : 'Three steps to a generation that reads your own brand. Usually under two minutes.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void dismiss()}
          className="-m-1 shrink-0 rounded-md p-1 text-content-tertiary transition-colors duration-micro hover:bg-surface-raised hover:text-content"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Hide the setup checklist</span>
        </button>
      </div>

      <div className="mt-4">
        <Progress
          label="Setup progress"
          value={checklist.completed}
          max={checklist.total}
          tone={checklist.activated ? 'success' : 'primary'}
        />
      </div>

      <ol className="mt-5 space-y-2">
        {checklist.steps.map((step) => (
          <li key={step.id}>
            <Link
              href={step.href}
              className={`flex items-start gap-3 rounded-md border p-3 transition-colors duration-micro ${
                step.next
                  ? 'border-[color:var(--color-primary)] bg-primary-subtle'
                  : 'border-[color:var(--color-border)] hover:bg-surface-raised'
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  step.done
                    ? 'border-success bg-success text-[color:var(--color-bg)]'
                    : 'border-[color:var(--color-border-strong)]'
                }`}
              >
                {step.done && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-sm font-medium ${
                      step.done ? 'text-content-tertiary line-through' : 'text-content'
                    }`}
                  >
                    {step.title}
                  </span>
                  {/* The state is in text as well as the tick and the colour. */}
                  <span className="sr-only">{step.done ? '(done)' : '(not done yet)'}</span>
                  {step.next && <Badge tone="info">Next</Badge>}
                </span>

                {!step.done && (
                  <span className="mt-1 block text-xs leading-5 text-content-secondary">{step.body}</span>
                )}
              </span>

              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-content-tertiary" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * The post-activation survey.
 *
 * Asked once, and only after the product has demonstrably worked — a survey
 * before activation measures the experience of people who never got value,
 * which is worth knowing but is a different question and needs different
 * wording.
 *
 * `survey_shown_at` is written when the user ANSWERS, not when this renders,
 * so navigating away means being asked again rather than never being asked.
 */
export function ActivationSurvey() {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  if (submitted) {
    return (
      <Card className="p-5">
        <p className="text-sm text-content-secondary">Thank you — that goes straight to the team.</p>
      </Card>
    );
  }

  async function submit() {
    if (score === null || sending) return;
    setSending(true);
    try {
      await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'survey', score, comment: comment || undefined }),
      });
      setSubmitted(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-content">How did that go?</h2>
      <p className="mt-1 text-sm leading-6 text-content-secondary">
        One question, and it is the only time we will ask.
      </p>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-content-secondary">
          How close was the output to something you would actually use?
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScore(value)}
              aria-pressed={score === value}
              className={`h-9 w-9 rounded-md border text-sm font-semibold transition-colors duration-micro ${
                score === value
                  ? 'border-[color:var(--color-primary)] bg-primary text-primary-fg'
                  : 'border-[color:var(--color-border)] text-content-secondary hover:bg-surface-raised'
              }`}
            >
              {value}
              <span className="sr-only">
                {value === 1 ? ' — not close at all' : value === 5 ? ' — I would use it as is' : ''}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-content-tertiary">1 = not close · 5 = I would use it as is</p>
      </fieldset>

      {/* Only after a score, so the form is one decision at a time. */}
      {score !== null && (
        <div className="mt-4 animate-fade-in">
          <label htmlFor="survey-comment" className="field-label">
            Anything you would change? (optional)
          </label>
          <textarea
            id="survey-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={2}
            maxLength={2000}
            className="input"
          />
          <Button className="mt-3" size="sm" loading={sending} onClick={() => void submit()}>
            Send
          </Button>
        </div>
      )}
    </Card>
  );
}
