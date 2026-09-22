'use client';

import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';

/**
 * Export and delete, together, in that order.
 *
 * Putting export directly above deletion is the entire design: the most
 * common reason someone lands here is that they want their data out, and a
 * deletion screen that does not offer the export first is how people lose
 * work they meant to keep.
 *
 * The confirmation asks for the account's email rather than the word DELETE.
 * A fixed word can be typed from muscle memory; an address forces the person
 * to confirm *which* account they are on, which is the mistake that actually
 * happens when someone has a personal and a work login open at once.
 */
export function DangerZone({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirm.trim().toLowerCase() === email.toLowerCase();

  async function exportData() {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch('/api/account/export');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Could not prepare your export.');
      }
      /*
       * Fetched rather than linked so an error renders as a message instead of
       * navigating the browser to a JSON error page — and because the response
       * is `no-store`, a plain link would also leave the export sitting in
       * history as a re-fetchable URL.
       */
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `owbrand-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare your export.');
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm, reason: reason || undefined }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Deletion failed.');

      // A full navigation, not a router push: the session is gone and every
      // cached server component on this client refers to an account that no
      // longer exists.
      window.location.href = '/?deleted=1';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed.');
      setBusy(false);
    }
  }

  return (
    <>
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Export your data</h2>
        <p className="mt-1 text-xs leading-5 text-content-secondary">
          Everything on your account as one JSON file: brands, products, approved facts, generated content,
          scheduled posts and your credit history. Access tokens for connected accounts are deliberately
          excluded — they are encrypted at rest and exporting them would put a working credential in your
          downloads folder.
        </p>
        <Button
          variant="subtle"
          size="sm"
          className="mt-4"
          loading={exporting}
          onClick={() => void exportData()}
          icon={<Download className="h-3.5 w-3.5" />}
        >
          Download my data
        </Button>
      </section>

      <section className="rounded-2xl border border-danger bg-danger-subtle p-6">
        <h2 className="font-display text-sm font-semibold text-ink">Delete account</h2>
        <p className="mt-1 text-xs leading-5 text-content-secondary">
          Permanently removes your brands, products, generated content, scheduled posts, connected accounts
          and analytics. Billing records are kept with your identity stripped out, because they are required
          for tax and accounting. This cannot be undone.
        </p>
        <Button
          variant="danger"
          size="sm"
          className="mt-4"
          onClick={() => setOpen(true)}
          icon={<Trash2 className="h-3.5 w-3.5" />}
        >
          Delete my account
        </Button>
        {error && !open && (
          <p role="alert" className="mt-3 text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title="Delete your account">
        <p className="text-sm leading-6 text-content-secondary">
          This is permanent. If you have not exported your data, close this and do that first.
        </p>

        <div className="mt-5 space-y-4">
          <Input
            label="Type your email address to confirm"
            hint={email}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Input
            label="Why are you leaving? (optional)"
            hint="Recorded with the deletion. It genuinely gets read."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-danger-subtle px-3 py-2 text-sm font-medium text-danger"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!matches} loading={busy} onClick={() => void deleteAccount()}>
            Delete permanently
          </Button>
        </div>
      </Modal>
    </>
  );
}
