'use client';

import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Skeleton } from '@/components/ui';

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * API key management.
 *
 * The design problem here is the one-time reveal. A key shown once and then
 * lost is a support ticket; a key stored retrievably is every customer's
 * credential sitting in our database. The second is far worse, so the interface
 * has to make the first genuinely hard to get wrong:
 *
 *  - the value appears in a modal that must be dismissed deliberately;
 *  - the warning is next to the value, not above the form where it is read
 *    before the value exists and forgotten by the time it does;
 *  - copying is one click, because the realistic failure is someone
 *    hand-transcribing 43 characters and getting one wrong.
 */
export function ApiKeys() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const response = await fetch('/api/account/keys');
      const body = await response.json();
      setKeys(body.keys ?? []);
    } catch {
      // An empty list, not a crash. The rest of settings still works.
      setKeys([]);
    }
  }

  async function create() {
    if (busy || name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/account/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes: ['read'] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? 'Could not create a key.');
      setIssued(body.key);
      setCreating(false);
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a key.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(keyId: string) {
    setError(null);
    try {
      const response = await fetch('/api/account/keys', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId }),
      });
      if (!response.ok) throw new Error('Could not revoke that key.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke that key.');
    }
  }

  const active = (keys ?? []).filter((key) => !key.revoked_at);

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-semibold text-ink">API keys</h2>
          <p className="mt-1 text-xs leading-5 text-content-secondary">
            Read access to your brands, posts and generated content.{' '}
            <a href="/docs/api" className="text-primary underline underline-offset-2">
              Read the API docs
            </a>
            .
          </p>
        </div>
        <Button size="sm" variant="subtle" onClick={() => setCreating(true)} icon={<Plus className="h-3.5 w-3.5" />}>
          New key
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-5">
        {keys === null ? (
          <Skeleton className="h-16 w-full" />
        ) : active.length === 0 ? (
          <p className="text-xs text-content-tertiary">No keys yet.</p>
        ) : (
          <ul className="space-y-2">
            {active.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3"
              >
                <KeyRound className="h-4 w-4 shrink-0 text-content-tertiary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{key.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-content-tertiary">{key.key_prefix}…</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {key.scopes.map((scope) => (
                    <Badge key={scope} tone="neutral">
                      {scope}
                    </Badge>
                  ))}
                  <span className="text-xs text-content-tertiary">
                    {key.last_used_at
                      ? `used ${new Date(key.last_used_at).toLocaleDateString('en-GB')}`
                      : /* Never used, said plainly — not shown as a date of
                           zero or an em dash that reads like a value. */
                        'never used'}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void revoke(key.id)}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New API key">
        <Input
          label="Name"
          hint="What will use this key? You will want to know later."
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder="Zapier integration"
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
          <Button loading={busy} disabled={name.trim().length === 0} onClick={() => void create()}>
            Create key
          </Button>
        </div>
      </Modal>

      <Modal
        open={issued !== null}
        onClose={() => {
          setIssued(null);
          setCopied(false);
        }}
        title="Copy your key now"
      >
        <p className="text-sm leading-6 text-content-secondary">
          This is the only time it will be shown. We store a hash, not the key, so it cannot be
          recovered — if you lose it, revoke it and make another.
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-raised p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-ink">{issued}</code>
          <Button
            size="sm"
            variant="subtle"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => {
              if (issued) void navigator.clipboard.writeText(issued).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <div className="mt-6 flex justify-end">
          <Button
            onClick={() => {
              setIssued(null);
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
