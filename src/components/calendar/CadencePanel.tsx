import { CalendarClock, CalendarX2, Layers } from 'lucide-react';
import { Card } from '@/components/ui';
import type { CadenceInsight } from '@/lib/calendar/month';

/**
 * The cadence summary.
 *
 * Every figure here is a count of real days or real posts. There is
 * deliberately no "consistency score": a percentage invites arguing with the
 * number, while "a 9-day gap starting Thursday" is something a person acts on
 * in a minute. The whole point of the panel is the next action, not a grade.
 *
 * Each card is hidden when it has nothing to say, rather than showing a zero.
 * "Longest gap: 0 days" is noise, and a panel of zeroes trains people to stop
 * reading it.
 */
export function CadencePanel({ insight }: { insight: CadenceInsight }) {
  const format = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  // Nothing at all scheduled is its own state: a grid of gaps with no
  // explanation reads as the page being broken.
  if (insight.scheduledAhead === 0) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-content-tertiary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-content">Nothing scheduled in the next two weeks</p>
            <p className="mt-1 text-sm leading-6 text-content-secondary">
              The calendar shows posts from the publishing queue. Schedule something and it appears
              here.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card className="p-5">
        <div className="flex items-center gap-2 text-content-tertiary">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-wide">Next 14 days</span>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums text-content">{insight.scheduledAhead}</p>
        <p className="mt-1 text-xs leading-5 text-content-secondary">
          {insight.scheduledAhead === 1 ? 'post scheduled' : 'posts scheduled'} across{' '}
          {14 - insight.emptyDaysAhead} of 14 days
        </p>
      </Card>

      {insight.longestGap && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-content-tertiary">
            <CalendarX2 className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-wide">Longest gap</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-content">
            {insight.longestGap.days} days
          </p>
          <p className="mt-1 text-xs leading-5 text-content-secondary">
            from {format(insight.longestGap.from)}
          </p>
        </Card>
      )}

      {insight.busiestDay && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-content-tertiary">
            <Layers className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-wide">Busiest day</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-content">
            {insight.busiestDay.count} posts
          </p>
          <p className="mt-1 text-xs leading-5 text-content-secondary">
            on {format(insight.busiestDay.date)}
          </p>
        </Card>
      )}
    </div>
  );
}
