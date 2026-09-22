'use client';

import { useEffect, useState } from 'react';
import { Copy, Plus, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { Badge, Button, Input, Modal, Skeleton } from '@/components/ui';

const EVENTS = ['post.published', 'post.failed', 'content.generated', 'approval.decided'] as const;

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  disabled_reason: string | null;
  consecutive_failures: number;
  created_at: string;
}

interface Delivery {
  id: string;
  endpoint_id: string;
  event_type: string;
  status: string;
  attempts: number;
  response_status: number | null;
  created_at: string;
}

/**
 * Webhook endpoint management.
 *
 * The delivery log is shown alongside the endpoints rather than behind a
 * separate screen, because the only question anyone has here is "did it fire,
 * and what did my server say" — and an integration debugging session that
 * requires navigating away is one where people give up and email support
 * instead.
 *
 * A disabled endpoint states WHY it was disabled. "Disabled" on its own reads
 * like something we chose to do, and the real reason is almost always that
 * their server has been returning errors for days.
 */
export function Webhooks() {
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['post.published']);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const response = await fetch('/api/account/webhooks');
      const body = await response.json();
      setEndpoints(body.endpoints ?? []);
      setDeliveries(body.deliveries ?? []);
    } catch {
      setEndpoints([]);
    }
  }

  async function add() {
    if (busy || events.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/account/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? 'Could not add that endpoint.');
      setSecret(body.secret);
      setAdding(false);
      setUrl('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that endpoint.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(endpointId: string) {
    setError(null);
    try {
      const response = await fetch('/api/account/webhooks', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpointId }),
      });
      if (!response.ok) throw new Error('Could not remove that endpoint.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that endpoint.');
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-semibold text-ink">Webhooks</h2>
          <p className="mt-1 text-xs leading-5 text-content-secondary">
            Signed HTTP callbacks when something is published.{' '}
            <a href="/docs/api#webhooks" className="text-primary underline underline-offset-2">
              How to verify the signature
            </a>
            .
          </p>
        </div>
        <Button size="sm" variant="subtle" onClick={() => setAdding(true)} icon={<Plus className="h-3.5 w-3.5" />}>
          Add endpoint
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-5">
        {endpoints === null ? (
          <Skeleton className="h-16 w-full" />
        ) : endpoints.length === 0 ? (
          <p className="text-xs text-content-tertiary">No endpoints yet.</p>
        ) : (
          <ul className="space-y-3">
            {endpoints.map((endpoint) => {
              const recent = deliveries.filter((d) => d.endpoint_id === endpoint.id).slice(0, 5);
              return (
                <li key={endpoint.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <WebhookIcon className="mt-0.5 h-4 w-4 shrink-0 text-content-tertiary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-ink">{endpoint.url}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {endpoint.events.map((event) => (
                          <Badge key={event} tone="neutral">
                            {event}
                          </Badge>
                        ))}
                        {!endpoint.enabled && <Badge tone="danger">disabled</Badge>}
                      </div>
                      {!endpoint.enabled && endpoint.disabled_reason && (
                        /* The reason, not just the state. "Disabled" alone
                           reads like something we decided to do. */
                        <p className="mt-2 text-xs text-danger">{endpoint.disabled_reason}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void remove(endpoint.id)}
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                    >
                      Remove
                    </Button>
                  </div>

                  {recent.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-line pt-3">
                      {recent.map((delivery) => (
                        <li key={delivery.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono text-content-tertiary">
                            {new Date(delivery.created_at).toLocaleString('en-GB')}
                          </span>
                          <span className="text-content-secondary">{delivery.event_type}</span>
                          <Badge
                            tone={
                              delivery.status === 'delivered'
                                ? 'success'
                                : delivery.status === 'pending'
                                  ? 'info'
                                  : 'danger'
                            }
                          >
                            {delivery.status}
                          </Badge>
                          {delivery.response_status !== null && (
                            <span className="tabular-nums text-content-tertiary">
                              HTTP {delivery.response_status}
                            </span>
                          )}
                          {delivery.attempts > 1 && (
                            <span className="text-content-tertiary">
                              {delivery.attempts} attempts
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a webhook endpoint">
        <Input
          label="Endpoint URL"
          hint="Must be https. Private and loopback addresses are refused."
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/hooks/owbrand"
          type="url"
        />

        <fieldset className="mt-5">
          <legend className="text-xs font-medium text-content-secondary">Events</legend>
          <div className="mt-2 space-y-2">
            {EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm text-content">
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={(changeEvent) =>
                    setEvents((current) =>
                      changeEvent.target.checked
                        ? [...current, event]
                        : current.filter((value) => value !== event)
                    )
                  }
                  className="h-4 w-4 rounded border-line"
                />
                <span className="font-mono text-xs">{event}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={url.trim().length === 0 || events.length === 0}
            onClick={() => void add()}
          >
            Add endpoint
          </Button>
        </div>
      </Modal>

      <Modal
        open={secret !== null}
        onClose={() => {
          setSecret(null);
          setCopied(false);
        }}
        title="Copy your signing secret"
      >
        <p className="text-sm leading-6 text-content-secondary">
          Shown once. Your server needs it to verify that a request really came from us — without
          it, anyone who learns your endpoint URL can post whatever they like to it.
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-raised p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{secret}</code>
          <Button
            size="sm"
            variant="subtle"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => {
              if (secret) void navigator.clipboard.writeText(secret).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={() => {
              setSecret(null);
              setCopied(false);
            }}
          >
            I have saved it
          </Button>
        </div>
      </Modal>
    </section>
  );
}
