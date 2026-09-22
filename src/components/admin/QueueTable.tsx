'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RotateCw } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Table, Td } from '@/components/ui';

export interface DeadLetterJob {
  id: string;
  brand_id: string;
  platform: string;
  attempts: number;
  max_attempts: number;
  requeue_count: number;
  dead_lettered_at: string | null;
  dead_letter_reason: string | null;
}

/**
 * The requeue table.
 *
 * Rows disappear on success rather than being marked "requeued in place": the
 * job is no longer dead-lettered, so leaving it in a list of dead-lettered
 * jobs would be showing a state that is no longer true — and would invite a
 * second click, which the database refuses but which looks like a bug.
 *
 * A job already requeued once is flagged. A job that keeps coming back is not
 * a transient platform failure, and the right response is to investigate it
 * rather than to click again.
 */
export function QueueTable({ jobs }: { jobs: DeadLetterJob[] }) {
  const [rows, setRows] = useState(jobs);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requeue(jobId: string) {
    setBusy(jobId);
    setError(null);
    try {
      const response = await fetch('/api/admin/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Requeue failed.');
      setRows((current) => current.filter((row) => row.id !== jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Requeue failed.');
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing in the dead-letter queue"
        body="Jobs land here when they exhaust their retries against a platform that was failing. An empty queue is the expected state."
        /*
         * EmptyState requires an action by design — an empty state with no way
         * forward is a dead end. Here the honest next step is the connection
         * health page, since a run of dead letters almost always traces back to
         * an account that needs reconnecting.
         */
        action={
          <Link href="/dashboard/connections">
            <Button size="sm" variant="subtle">
              Check connection health
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <Card>
      {error && (
        <p
          role="alert"
          className="border-b border-[color:var(--color-border)] px-4 py-3 text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}

      <Table
        caption="Publishing jobs that exhausted their retries"
        columns={[
          { key: 'platform', label: 'Platform' },
          { key: 'attempts', label: 'Attempts', numeric: true },
          { key: 'failed', label: 'Failed at' },
          { key: 'reason', label: 'Reason' },
          { key: 'action', label: 'Action' },
        ]}
      >
        {rows.map((job) => (
          <tr key={job.id} className="border-t border-[color:var(--color-border)]">
            <Td>
              <span className="font-medium capitalize">{job.platform}</span>
            </Td>
            <Td>
              <span className="tabular-nums">
                {job.attempts}/{job.max_attempts}
              </span>
              {job.requeue_count > 0 && (
                <span className="ml-2">
                  {/* A job that keeps returning is not a transient failure. */}
                  <Badge tone="warning">requeued {job.requeue_count}×</Badge>
                </span>
              )}
            </Td>
            <Td>
              {job.dead_lettered_at ? (
                <time dateTime={job.dead_lettered_at} className="tabular-nums">
                  {new Date(job.dead_lettered_at).toLocaleString('en-GB')}
                </time>
              ) : (
                // Null, not "—" masquerading as a value.
                <span className="text-content-tertiary">unknown</span>
              )}
            </Td>
            <Td>
              <span className="text-xs text-content-secondary">
                {job.dead_letter_reason ?? 'not recorded'}
              </span>
            </Td>
            <Td>
              <Button
                size="sm"
                variant="subtle"
                loading={busy === job.id}
                onClick={() => void requeue(job.id)}
                icon={<RotateCw className="h-3.5 w-3.5" />}
              >
                Requeue
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
