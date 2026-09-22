import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import type { CalendarMonth, CalendarPost } from '@/lib/calendar/month';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The month grid.
 *
 * A server component with link-based navigation rather than client state, so
 * a month is a URL: shareable, bookmarkable, and working with the back button.
 * A calendar whose position lives in React state loses it on every refresh,
 * which is exactly when someone is comparing two months.
 *
 * Accessibility decisions that are load-bearing here:
 *
 *  - It is a real `<table>` with `<th scope="col">` weekday headers. A grid of
 *    divs is unnavigable with a screen reader, and a calendar is one of the
 *    few layouts where the table semantics are genuinely correct.
 *  - Each cell's date is announced in full via a visually hidden label. "17"
 *    on its own is meaningless out of the visual grid context.
 *  - Post count is text, never only a coloured dot.
 */
export function MonthGrid({
  grid,
  brands,
  activeBrand,
}: {
  grid: CalendarMonth;
  brands: Array<{ id: string; name: string }>;
  activeBrand: string | null;
}) {
  const href = (year: number, month: number) => {
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (activeBrand) params.set('brand', activeBrand);
    return `/dashboard/calendar?${params.toString()}`;
  };

  const weeks: typeof grid.days[] = [];
  for (let index = 0; index < grid.days.length; index += 7) {
    weeks.push(grid.days.slice(index, index + 7));
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)] p-4">
        <div className="flex items-center gap-1">
          <Link
            href={href(grid.previous.year, grid.previous.month)}
            className="rounded-md p-2 text-content-secondary transition-colors duration-micro hover:bg-surface-raised hover:text-content"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Previous month</span>
          </Link>
          <Link
            href={href(grid.next.year, grid.next.month)}
            className="rounded-md p-2 text-content-secondary transition-colors duration-micro hover:bg-surface-raised hover:text-content"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Next month</span>
          </Link>
          <span className="ml-2 text-sm font-semibold text-content">{grid.label}</span>
        </div>

        {brands.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/dashboard/calendar?year=${grid.year}&month=${grid.month}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-micro ${
                activeBrand === null
                  ? 'bg-primary text-[color:var(--color-on-primary)]'
                  : 'text-content-secondary hover:bg-surface-raised'
              }`}
            >
              All brands
            </Link>
            {brands.map((brand) => (
              <Link
                key={brand.id}
                href={`/dashboard/calendar?year=${grid.year}&month=${grid.month}&brand=${brand.id}`}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-micro ${
                  activeBrand === brand.id
                    ? 'bg-primary text-[color:var(--color-on-primary)]'
                    : 'text-content-secondary hover:bg-surface-raised'
                }`}
              >
                {brand.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse">
          <caption className="sr-only">
            Posts scheduled and published in {grid.label}, one cell per day.
          </caption>
          <thead>
            <tr>
              {WEEKDAYS.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="border-b border-[color:var(--color-border)] px-2 py-2 text-xs font-medium text-content-tertiary"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0].date}>
                {week.map((day) => (
                  <td
                    key={day.date}
                    className={`h-28 max-w-0 border border-[color:var(--color-border)] p-1.5 align-top ${
                      day.inMonth ? '' : 'bg-surface-raised/50'
                    } ${day.isToday ? 'ring-1 ring-inset ring-[color:var(--color-primary)]' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs tabular-nums ${
                          day.isToday
                            ? 'font-bold text-primary'
                            : day.inMonth
                              ? 'text-content-secondary'
                              : 'text-content-tertiary'
                        }`}
                      >
                        {day.dayOfMonth}
                        {/* "17" alone means nothing outside the visual grid. */}
                        <span className="sr-only">
                          {' '}
                          {new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })}
                          {day.isToday ? ', today' : ''}
                        </span>
                      </span>
                      {day.posts.length > 2 && (
                        <span className="text-[10px] tabular-nums text-content-tertiary">
                          {day.posts.length}
                        </span>
                      )}
                    </div>

                    <ul className="mt-1 space-y-1">
                      {day.posts.slice(0, 2).map((post) => (
                        <li key={post.id}>
                          <PostChip post={post} dimmed={day.isPast} />
                        </li>
                      ))}
                      {day.posts.length > 2 && (
                        <li className="px-1 text-[10px] text-content-tertiary">
                          +{day.posts.length - 2} more
                        </li>
                      )}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PostChip({ post, dimmed }: { post: CalendarPost; dimmed: boolean }) {
  const tone =
    post.status === 'published'
      ? 'success'
      : post.status === 'failed'
        ? 'danger'
        : post.status === 'publishing'
          ? 'info'
          : 'neutral';

  return (
    <span className={`block ${dimmed ? 'opacity-70' : ''}`}>
      <Badge tone={tone}>
        <span className="truncate">
          {/* Platform then caption: at this width the platform is the part
              that survives truncation, and it is the more useful of the two
              at a glance. */}
          {post.platform}
          {post.caption ? ` · ${post.caption.slice(0, 24)}` : ''}
        </span>
      </Badge>
    </span>
  );
}
