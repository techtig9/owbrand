import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Billing webhook idempotency.
 *
 * The bug this guards against: `transaction.completed` reset
 * credits_remaining to the plan maximum on every occurrence, and the
 * `payments` insert that would have failed on its unique
 * paddle_transaction_id had its error ignored. Replaying one validly signed
 * event was therefore a repeatable free credit top-up.
 *
 * A fake table enforces the real unique (provider, event_id) constraint so the
 * claim/complete/release logic is exercised against the same failure mode
 * Postgres would produce.
 */

interface EventRow {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  status: string;
  payload_digest: string | null;
  error: string | null;
  processed_at: string | null;
}

let rows: EventRow[];
let nextId: number;

function makeFakeDb() {
  return {
    from(table: string) {
      if (table !== 'webhook_events') throw new Error(`unexpected table ${table}`);

      let filtered = [...rows];
      let pendingInsert: Partial<EventRow> | null = null;
      let pendingUpdate: Partial<EventRow> | null = null;
      let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';

      const builder: Record<string, any> = {
        insert(values: Partial<EventRow>) {
          mode = 'insert';
          pendingInsert = values;
          return builder;
        },
        update(values: Partial<EventRow>) {
          mode = 'update';
          pendingUpdate = values;
          return builder;
        },
        delete() {
          mode = 'delete';
          return builder;
        },
        select() {
          return builder;
        },
        eq(column: keyof EventRow, value: unknown) {
          filtered = filtered.filter((r) => r[column] === value);
          return builder;
        },
        maybeSingle() {
          if (mode === 'delete') {
            rows = rows.filter((r) => !filtered.includes(r));
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        },
        single() {
          if (mode === 'insert' && pendingInsert) {
            // The real unique constraint.
            const clash = rows.find(
              (r) => r.provider === pendingInsert!.provider && r.event_id === pendingInsert!.event_id
            );
            if (clash) {
              return Promise.resolve({
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint' },
              });
            }
            const row: EventRow = {
              id: `row-${nextId++}`,
              provider: pendingInsert.provider ?? 'paddle',
              event_id: pendingInsert.event_id!,
              event_type: pendingInsert.event_type ?? 'unknown',
              status: pendingInsert.status ?? 'processing',
              payload_digest: pendingInsert.payload_digest ?? null,
              error: null,
              processed_at: null,
            };
            rows.push(row);
            return Promise.resolve({ data: { id: row.id }, error: null });
          }
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        },
        then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
          if (mode === 'update' && pendingUpdate) {
            for (const row of filtered) Object.assign(row, pendingUpdate);
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          if (mode === 'delete') {
            rows = rows.filter((r) => !filtered.includes(r));
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve({ data: filtered, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => makeFakeDb() }));

const { claimWebhookEvent, completeWebhookEvent, releaseWebhookEvent } = await import(
  '@/lib/billing/webhook-store'
);

beforeEach(() => {
  rows = [];
  nextId = 1;
});

describe('claimWebhookEvent', () => {
  it('claims an unseen event', async () => {
    const result = await claimWebhookEvent({
      eventId: 'evt_001',
      eventType: 'transaction.completed',
    });

    expect(result.claimed).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('processing');
  });

  it('REFUSES a replay of the same event — the free-credits bug', async () => {
    const first = await claimWebhookEvent({ eventId: 'evt_replay', eventType: 'transaction.completed' });
    expect(first.claimed).toBe(true);

    const replay = await claimWebhookEvent({ eventId: 'evt_replay', eventType: 'transaction.completed' });
    expect(replay.claimed).toBe(false);
    expect(replay).toMatchObject({ reason: 'duplicate' });

    // Critically: no second row, so no side effect can run twice.
    expect(rows).toHaveLength(1);
  });

  it('refuses a replay even after the first run completed', async () => {
    const first = await claimWebhookEvent({ eventId: 'evt_done', eventType: 'transaction.completed' });
    if (!first.claimed) throw new Error('expected first claim to succeed');
    await completeWebhookEvent(first.rowId, 'processed');

    const replay = await claimWebhookEvent({ eventId: 'evt_done', eventType: 'transaction.completed' });
    expect(replay.claimed).toBe(false);
    expect(replay).toMatchObject({ reason: 'duplicate', previousStatus: 'processed' });
  });

  it('treats different event ids as distinct', async () => {
    await claimWebhookEvent({ eventId: 'evt_a', eventType: 'subscription.created' });
    const second = await claimWebhookEvent({ eventId: 'evt_b', eventType: 'subscription.created' });

    expect(second.claimed).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('scopes the key by provider', async () => {
    await claimWebhookEvent({ provider: 'paddle', eventId: 'shared', eventType: 'x' });
    const other = await claimWebhookEvent({ provider: 'stripe', eventId: 'shared', eventType: 'x' });
    expect(other.claimed).toBe(true);
  });
});

describe('completeWebhookEvent', () => {
  it('records a processed outcome', async () => {
    const claim = await claimWebhookEvent({ eventId: 'evt_ok', eventType: 'subscription.created' });
    if (!claim.claimed) throw new Error('claim failed');

    await completeWebhookEvent(claim.rowId, 'processed');

    expect(rows[0].status).toBe('processed');
    expect(rows[0].processed_at).toBeTruthy();
  });

  it('records a failure with a truncated reason', async () => {
    const claim = await claimWebhookEvent({ eventId: 'evt_bad', eventType: 'subscription.created' });
    if (!claim.claimed) throw new Error('claim failed');

    await completeWebhookEvent(claim.rowId, 'failed', 'x'.repeat(900));

    expect(rows[0].status).toBe('failed');
    expect(rows[0].error!.length).toBeLessThanOrEqual(500);
  });
});

describe('releaseWebhookEvent', () => {
  it('frees the key so a provider retry can be processed', async () => {
    const claim = await claimWebhookEvent({ eventId: 'evt_transient', eventType: 'transaction.completed' });
    if (!claim.claimed) throw new Error('claim failed');

    // Simulates a transient database failure mid-handler.
    await releaseWebhookEvent(claim.rowId);
    expect(rows).toHaveLength(0);

    // Paddle's retry must now succeed rather than being rejected as a
    // duplicate of a run that never completed.
    const retry = await claimWebhookEvent({ eventId: 'evt_transient', eventType: 'transaction.completed' });
    expect(retry.claimed).toBe(true);
  });
});
