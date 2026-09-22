import { describe, expect, it } from 'vitest';
import { buildMonth, cadence, postDate, daysInMonth, type CalendarPost } from '@/lib/calendar/month';

/**
 * Calendar arithmetic.
 *
 * Dates are where quiet bugs live, and the ones that matter here only appear
 * at boundaries: a month that starts on a Sunday, a leap year, a post
 * published a day after it was scheduled. Each of those has a test.
 */

function post(overrides: Partial<CalendarPost> = {}): CalendarPost {
  return {
    id: Math.random().toString(36).slice(2),
    brand_id: 'b1',
    platform: 'instagram',
    status: 'scheduled',
    caption: 'x',
    scheduled_for: null,
    published_at: null,
    ...overrides,
  };
}

describe('which day a post belongs on', () => {
  it('uses published_at over scheduled_for', () => {
    // A post scheduled Monday and published Tuesday belongs on Tuesday. A
    // calendar that showed Monday would be wrong about what happened.
    const p = post({ scheduled_for: '2026-03-02T10:00:00Z', published_at: '2026-03-03T08:00:00Z' });
    expect(postDate(p)).toBe('2026-03-03');
  });

  it('falls back to scheduled_for when not yet published', () => {
    expect(postDate(post({ scheduled_for: '2026-03-02T10:00:00Z' }))).toBe('2026-03-02');
  });

  it('returns null for a draft with no date', () => {
    expect(postDate(post())).toBeNull();
  });
});

describe('the grid', () => {
  it('is always whole weeks', () => {
    for (const month of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(buildMonth(2026, month, []).days.length % 7).toBe(0);
    }
  });

  it('starts on a Monday', () => {
    const grid = buildMonth(2026, 3, []);
    // 1 March 2026 is a Sunday, so the grid must lead with six February days.
    expect(new Date(`${grid.days[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('handles a month that begins on a Sunday without dropping a week', () => {
    // The case a naive `firstDay = getUTCDay()` gets wrong: Sunday is 0, so
    // no leading days are added and 1 March lands in the Monday column.
    const grid = buildMonth(2026, 3, []);
    const first = grid.days.find((day) => day.inMonth && day.dayOfMonth === 1)!;
    expect(new Date(`${first.date}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(grid.days.indexOf(first)).toBe(6);
  });

  it('contains every day of the month exactly once', () => {
    const grid = buildMonth(2026, 2, []);
    const inMonth = grid.days.filter((day) => day.inMonth).map((day) => day.dayOfMonth);
    expect(inMonth).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it('gets February right in a leap year', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28); // divisible by 100, not by 400
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('wraps the year at both ends', () => {
    expect(buildMonth(2026, 1, []).previous).toEqual({ year: 2025, month: 12 });
    expect(buildMonth(2026, 12, []).next).toEqual({ year: 2027, month: 1 });
  });

  it('places posts on the right day', () => {
    const grid = buildMonth(2026, 3, [post({ scheduled_for: '2026-03-17T09:00:00Z' })]);
    const day = grid.days.find((d) => d.date === '2026-03-17')!;
    expect(day.posts).toHaveLength(1);
    expect(grid.days.filter((d) => d.posts.length > 0)).toHaveLength(1);
  });

  it('marks today and the past', () => {
    const today = new Date('2026-03-15T12:00:00Z');
    const grid = buildMonth(2026, 3, [], today);
    expect(grid.days.find((d) => d.date === '2026-03-15')!.isToday).toBe(true);
    expect(grid.days.find((d) => d.date === '2026-03-14')!.isPast).toBe(true);
    expect(grid.days.find((d) => d.date === '2026-03-16')!.isPast).toBe(false);
  });
});

describe('cadence', () => {
  const today = new Date('2026-03-01T12:00:00Z');

  it('counts empty days in the horizon', () => {
    const posts = [post({ scheduled_for: '2026-03-02T09:00:00Z' })];
    expect(cadence(posts, today, 14).emptyDaysAhead).toBe(13);
  });

  it('finds the longest gap', () => {
    const posts = [
      post({ scheduled_for: '2026-03-01T09:00:00Z' }),
      post({ scheduled_for: '2026-03-02T09:00:00Z' }),
      // Then nothing until the 12th: a 9-day gap.
      post({ scheduled_for: '2026-03-12T09:00:00Z' }),
    ];
    const result = cadence(posts, today, 14);
    expect(result.longestGap).toEqual({ days: 9, from: '2026-03-03' });
  });

  it('ignores a two-day gap', () => {
    // A weekend is not a problem, and flagging it would make the insight
    // noise that people learn to skip.
    const posts = Array.from({ length: 14 }, (_, offset) =>
      post({ scheduled_for: `2026-03-${String(offset + 1).padStart(2, '0')}T09:00:00Z` })
    ).filter((_, index) => index !== 5 && index !== 6);

    expect(cadence(posts, today, 14).longestGap).toBeNull();
  });

  it('reports a busiest day only when something is genuinely stacked', () => {
    const one = [post({ scheduled_for: '2026-03-03T09:00:00Z' })];
    // "Busiest day: 1 post" is a sentence, not an insight.
    expect(cadence(one, today, 14).busiestDay).toBeNull();

    const many = Array.from({ length: 3 }, () => post({ scheduled_for: '2026-03-03T09:00:00Z' }));
    expect(cadence(many, today, 14).busiestDay).toEqual({ date: '2026-03-03', count: 3 });
  });

  it('ignores posts in the past', () => {
    const posts = [post({ published_at: '2026-02-20T09:00:00Z' })];
    const result = cadence(posts, today, 14);
    expect(result.scheduledAhead).toBe(0);
    expect(result.emptyDaysAhead).toBe(14);
  });

  it('reports a completely empty horizon without a division or a crash', () => {
    const result = cadence([], today, 14);
    expect(result.emptyDaysAhead).toBe(14);
    expect(result.scheduledAhead).toBe(0);
    expect(result.longestGap).toEqual({ days: 14, from: '2026-03-01' });
  });
});
