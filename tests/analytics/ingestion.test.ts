import { describe, it, expect } from 'vitest';
import { resolveWindow } from '@/lib/analytics/ingestion';

/**
 * The ingestion window.
 *
 * Three properties, each protecting against a specific and expensive mistake:
 *
 *   - INCREMENTAL. Re-fetching full history every run exhausts Meta's hourly
 *     call budget, which is shared with publishing — so a greedy analytics run
 *     would also stop posts going out.
 *   - OVERLAPPING. Platforms revise recent numbers for ~72 hours. Ingesting a
 *     day once and never looking again bakes in provisional figures.
 *   - NEVER TODAY. A partial day looks like a collapse in performance and
 *     poisons every period-over-period comparison.
 */

const TODAY = new Date('2026-09-10T12:00:00Z');

describe('resolveWindow', () => {
  it('never requests today', () => {
    const window = resolveWindow(null, { today: TODAY });
    expect(window?.until).toBe('2026-09-09');
  });

  it('backfills a fixed window on a first run', () => {
    const window = resolveWindow(null, { today: TODAY, backfillDays: 30 });
    expect(window).toEqual({ since: '2026-08-11', until: '2026-09-09' });
  });

  it('respects a platform maximum window on first run', () => {
    // Instagram refuses insights windows longer than 30 days; asking for 90
    // fails the whole call rather than returning 30.
    const window = resolveWindow(null, { today: TODAY, backfillDays: 90, maxWindowDays: 30 });
    expect(window?.since).toBe('2026-08-11');
  });

  it('resumes from the cursor, overlapping the restatement window', () => {
    // Cursor at the 8th; the window reaches back to pick up revisions.
    const window = resolveWindow('2026-09-08', { today: TODAY });
    expect(window?.since).toBe('2026-09-06');
    expect(window?.until).toBe('2026-09-09');
  });

  it('overlaps rather than resuming from the day after the cursor', () => {
    // Resuming at cursor+1 would never re-read a revised figure.
    const window = resolveWindow('2026-09-09', { today: TODAY });
    expect(window!.since < '2026-09-09').toBe(true);
  });

  it('returns null when there is genuinely nothing new', () => {
    // A cursor already past yesterday. Requesting anyway would burn a call.
    const window = resolveWindow('2026-09-20', { today: TODAY });
    expect(window).toBeNull();
  });

  it('clamps a very old cursor to the maximum window', () => {
    // A brand reconnected after a year must not trigger a 365-day fetch.
    const window = resolveWindow('2024-01-01', { today: TODAY, maxWindowDays: 30 });
    expect(window?.since).toBe('2026-08-11');
    expect(window?.until).toBe('2026-09-09');
  });

  it('produces a valid range in every case it returns one', () => {
    for (const cursor of [null, '2026-09-01', '2026-08-01', '2020-01-01']) {
      const window = resolveWindow(cursor, { today: TODAY, maxWindowDays: 30 });
      if (window) expect(window.since <= window.until).toBe(true);
    }
  });
});
