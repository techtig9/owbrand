import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isMonitoringConfigured } from '@/lib/monitoring';
import { isEmailDeliverable } from '@/lib/email/providers';
import { Badge, Card, Table, Td } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Operations.
 *
 * This is NOT an error tracker, and it does not pretend to be one. Application
 * errors go to the log stream; nothing in this product stores them, so a page
 * claiming to list "recent errors" would either be empty or made up.
 *
 * What it shows is the failure state that IS durably recorded: dead-lettered
 * publishing jobs, failed webhook deliveries, and failed email sends. Those
 * are the three places where something silently stopped working for a
 * customer, and they are the ones worth a daily glance.
 *
 * The banner about monitoring is there so the gap is visible rather than
 * assumed away. An admin panel that shows three healthy counters implies
 * everything is fine; one that says "no error tracker is configured" tells the
 * truth about what is and is not being watched.
 */
export default async function AdminOperationsPage() {
  const db = supabaseAdmin();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [deadLetters, webhookFailures, emailFailures, recentAudit] = await Promise.all([
    db.from('publishing_jobs').select('id', { count: 'exact', head: true }).eq('status', 'dead_letter'),
    db
      .from('webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .in('status', ['failed', 'dead_letter'])
      .gte('created_at', dayAgo),
    db
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', dayAgo),
    db
      .from('audit_logs')
      .select('action, actor_type, entity_type, created_at')
      .order('created_at', { ascending: false })
      .limit(25),
  ]);

  const stats = [
    {
      label: 'Dead-lettered posts',
      value: deadLetters.count ?? 0,
      note: 'Exhausted their retries. Replayable.',
      href: '/admin/queue',
      bad: (deadLetters.count ?? 0) > 0,
    },
    {
      label: 'Webhook failures (24h)',
      value: webhookFailures.count ?? 0,
      note: 'Deliveries that did not reach a customer endpoint.',
      href: null,
      bad: (webhookFailures.count ?? 0) > 0,
    },
    {
      label: 'Email failures (24h)',
      value: emailFailures.count ?? 0,
      note: 'Transactional mail the provider rejected.',
      href: null,
      bad: (emailFailures.count ?? 0) > 0,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Operations</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-content-secondary">
          The failure states that are durably recorded. Application errors are not stored anywhere,
          so they are not listed here — see the note below.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => {
          const body = (
            <Card className="h-full p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-content-tertiary">
                {stat.label}
              </p>
              <p
                className={`mt-2 text-3xl font-bold tabular-nums ${stat.bad ? 'text-danger' : 'text-content'}`}
              >
                {stat.value}
              </p>
              <p className="mt-1 text-xs leading-5 text-content-secondary">{stat.note}</p>
            </Card>
          );
          return stat.href ? (
            <Link key={stat.label} href={stat.href} className="block">
              {body}
            </Link>
          ) : (
            <div key={stat.label}>{body}</div>
          );
        })}
      </div>

      {!isMonitoringConfigured() && (
        <div role="alert" className="rounded-2xl border border-warning bg-warning-subtle p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">
            No error tracker configured
          </p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-content-secondary">
            Application errors go to the log stream and nowhere else, so nothing here counts them.
            The integration point is <code className="font-mono text-xs">src/lib/monitoring.ts</code>
            , which already structures every report with a stable fingerprint — wiring a vendor is
            one function body, not a sweep through the codebase.
          </p>
        </div>
      )}

      {!isEmailDeliverable() && (
        <div role="alert" className="rounded-2xl border border-warning bg-warning-subtle p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">
            No email provider configured
          </p>
          <p className="mt-1 text-sm leading-6 text-content-secondary">
            Transactional mail is not being sent. The count above is zero because nothing is
            attempted, not because everything is delivering.
          </p>
        </div>
      )}

      <Card>
        <Table
          caption="Recent privileged and security-relevant actions"
          columns={[
            { key: 'action', label: 'Action' },
            { key: 'actor', label: 'Actor' },
            { key: 'entity', label: 'Entity' },
            { key: 'when', label: 'When' },
          ]}
        >
          {(recentAudit.data ?? []).map((row, index) => (
            <tr key={`${row.created_at}-${index}`} className="border-t border-[color:var(--color-border)]">
              <Td>
                <code className="font-mono text-xs">{row.action}</code>
              </Td>
              <Td>
                <Badge tone={row.actor_type === 'admin' ? 'warning' : 'neutral'}>{row.actor_type}</Badge>
              </Td>
              <Td>
                <span className="text-xs text-content-secondary">{row.entity_type}</span>
              </Td>
              <Td>
                <time dateTime={row.created_at} className="tabular-nums text-xs">
                  {new Date(row.created_at).toLocaleString('en-GB')}
                </time>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <p className="text-xs leading-5 text-content-tertiary">
        There is deliberately no impersonation feature in this panel. Support can read state and
        grant credits; it cannot act as a customer. Impersonation makes every audit row ambiguous
        about who really did something, and that ambiguity is permanent.
      </p>
    </div>
  );
}
