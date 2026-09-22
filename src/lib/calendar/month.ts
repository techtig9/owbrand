/**
 * Calendar assembly.
 *
 * The scheduler already lists what is queued. A calendar is worth building
 * only if it answers something a list cannot, and it does: **cadence**. A list
 * sorted by date will happily show twelve posts without making it obvious that
 * nine of them are on Tuesday and there is nothing at all for the next nine
 * days. That is the actual content-planning problem, and it is a shape
 * problem, so it needs a shape.
 *
 * Everything here is pure and date-only, so it can be tested without a
 * database and without mocking a clock.
 */

export interface CalendarPost {
  id: string;
  brand_id: string;
  platform: string;
  status: string;
  caption: string | null;
  scheduled_for: string | null;
  published_at: string | null;
}

export interface CalendarDay {
  /** ISO date, `YYYY-MM-DD`, in the viewer's chosen timezone. */
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  posts: CalendarPost[];
}

export interface CalendarMonth {
  year: number;
  /** 1–12, because a zero-indexed month in a URL is a bug generator. */
  month: number;
  label: string;
  /** Always whole weeks, so the grid is rectangular. */
  days: CalendarDay[];
  previous: { year: number; month: number };
  next: { year: number; month: number };
}

/**
 * The date a post belongs on.
 *
 * `published_at` wins over `scheduled_for`: a post scheduled for Monday and
 * published Tuesday belongs on Tuesday, because the calendar is a record of
 * what happened as much as a plan of what will. A calendar that showed it on
 * Monday would be quietly wrong about history.
 */
export function postDate(post: CalendarPost): string | null {
  const stamp = post.published_at ?? post.scheduled_for;
  return stamp ? stamp.slice(0, 10) : null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Days in a month. Month is 1-indexed. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Builds the grid.
 *
 * Weeks start Monday. This is a European product by origin and the whole point
 * of a content calendar is the working week — a grid that splits Saturday and
 * Sunday across two rows makes "the weekend" impossible to see at a glance.
 *
 * All arithmetic is in UTC. Building a calendar from local dates means a
 * server in one timezone and a viewer in another disagree about which day a
 * post falls on, and the bug only appears near midnight, which is when
 * scheduled posts actually go out.
 */
export function buildMonth(
  year: number,
  month: number,
  posts: CalendarPost[],
  today = new Date()
): CalendarMonth {
  const byDate = new Map<string, CalendarPost[]>();
  for (const post of posts) {
    const date = postDate(post);
    if (!date) continue;
    const bucket = byDate.get(date);
    if (bucket) bucket.push(post);
    else byDate.set(date, [post]);
  }

  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const leading = (first.getUTCDay() + 6) % 7;

  const total = daysInMonth(year, month);
  const todayIso = isoDate(today);

  const days: CalendarDay[] = [];

  // Leading days from the previous month, so the first week is complete.
  for (let index = leading; index > 0; index--) {
    const date = new Date(Date.UTC(year, month - 1, 1 - index));
    days.push(dayFor(date, false, todayIso, byDate));
  }

  for (let dayOfMonth = 1; dayOfMonth <= total; dayOfMonth++) {
    days.push(dayFor(new Date(Date.UTC(year, month - 1, dayOfMonth)), true, todayIso, byDate));
  }

  // Trailing days to complete the final week. Without this the last row is
  // ragged and the grid's columns stop lining up with the weekday headers.
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    const next = new Date(`${last.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    days.push(dayFor(next, false, todayIso, byDate));
  }

  return {
    year,
    month,
    label: new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    days,
    previous: month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    next: month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 },
  };
}

function dayFor(
  date: Date,
  inMonth: boolean,
  todayIso: string,
  byDate: Map<string, CalendarPost[]>
): CalendarDay {
  const iso = isoDate(date);
  return {
    date: iso,
    dayOfMonth: date.getUTCDate(),
    inMonth,
    isToday: iso === todayIso,
    isPast: iso < todayIso,
    posts: byDate.get(iso) ?? [],
  };
}

export interface CadenceInsight {
  /** Days in the next fortnight with nothing scheduled. */
  emptyDaysAhead: number;
  /** The longest run of consecutive empty days ahead, and when it starts. */
  longestGap: { days: number; from: string } | null;
  /** Scheduled posts in the next fortnight. */
  scheduledAhead: number;
  /** The busiest upcoming day, if anything is stacked. */
  busiestDay: { date: string; count: number } | null;
}

/**
 * What the calendar is actually for.
 *
 * Reported as counts of real days, never as a score or a "consistency rating".
 * "You have a 9-day gap starting Thursday" is something a person can act on in
 * a minute. "Consistency: 62%" is not, and it invites arguing with the number
 * instead of filling the gap.
 */
export function cadence(posts: CalendarPost[], today = new Date(), horizonDays = 14): CadenceInsight {
  const todayIso = isoDate(today);

  const upcoming = new Set<string>();
  const counts = new Map<string, number>();

  for (const post of posts) {
    const date = postDate(post);
    if (!date || date < todayIso) continue;
    upcoming.add(date);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  const horizon: string[] = [];
  for (let offset = 0; offset < horizonDays; offset++) {
    const date = new Date(today.getTime());
    date.setUTCDate(date.getUTCDate() + offset);
    horizon.push(isoDate(date));
  }

  const empty = horizon.filter((date) => !upcoming.has(date));

  let longestGap: { days: number; from: string } | null = null;
  let run = 0;
  let runStart = '';

  for (const date of horizon) {
    if (upcoming.has(date)) {
      run = 0;
      continue;
    }
    if (run === 0) runStart = date;
    run += 1;
    // Three days is the threshold: a one- or two-day gap is a weekend, not a
    // problem, and flagging it would make the insight noise.
    if (run >= 3 && (!longestGap || run > longestGap.days)) {
      longestGap = { days: run, from: runStart };
    }
  }

  const busiest = [...counts.entries()]
    .filter(([date]) => horizon.includes(date))
    .sort((a, b) => b[1] - a[1])[0];

  return {
    emptyDaysAhead: empty.length,
    longestGap,
    scheduledAhead: horizon.reduce((total, date) => total + (counts.get(date) ?? 0), 0),
    // Only when something is genuinely stacked. "Busiest day: 1 post" is not
    // an insight, it is a sentence.
    busiestDay: busiest && busiest[1] >= 3 ? { date: busiest[0], count: busiest[1] } : null,
  };
}
