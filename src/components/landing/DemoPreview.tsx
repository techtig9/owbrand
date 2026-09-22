import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';

/**
 * The static fallback, shown when the deployment cannot run the live demo.
 *
 * Two rules it follows, and both are the reason it exists rather than the old
 * mockup:
 *
 *  1. **No interactive controls.** Not a disabled button, not a greyed input —
 *     none at all, apart from the one link that does work. The previous
 *     component's "Generate" button, microphone and device tabs all looked
 *     live and did nothing; a disabled version of the same thing is still a
 *     control the eye is drawn to and the hand cannot use.
 *  2. **Labelled as an example, in the content and not only in a caption.**
 *     The badge says "Example", the values are visibly a worked example, and
 *     the note under it says what the visitor is looking at.
 *
 * The example values are a plausible sketch for the business described, not
 * output from any particular model, and nothing here claims otherwise.
 */
export function DemoPreview() {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Example</Badge>
        <span className="text-xs text-content-tertiary">
          Not live output — the interactive demo needs an AI provider configured
        </span>
      </div>

      <p className="mt-4 rounded-md bg-surface-raised px-3 py-2 text-sm italic leading-6 text-content-secondary">
        “A small-batch ceramics studio in Lisbon selling hand-thrown tableware to restaurants.”
      </p>

      <p className="mt-5 text-xl font-semibold leading-snug text-content">
        Tableware with the marks of the hand that made it.
      </p>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-content-tertiary">Voice</dt>
          <dd className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="badge-neutral">unhurried</span>
            <span className="badge-neutral">tactile</span>
            <span className="badge-neutral">exacting</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-content-tertiary">Audience</dt>
          <dd className="mt-1.5 text-sm leading-6 text-content-secondary">
            Chefs and restaurant owners specifying tableware for a room they have designed themselves.
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md bg-surface-raised p-4">
        <p className="min-w-0 flex-1 text-sm leading-6 text-content-secondary">
          A real Brand Brain stores more than this — positioning, the claims you are allowed to make, and the
          ones you are not — and every generation afterwards reads it.
        </p>
        <Link href="/signup">
          <Button size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />}>
            Build your brand
          </Button>
        </Link>
      </div>
    </Card>
  );
}
