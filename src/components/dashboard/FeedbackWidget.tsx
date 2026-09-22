'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import { Button, Modal, Select, Textarea } from '@/components/ui';

/**
 * In-app feedback.
 *
 * A real modal from the primitive library, so it inherits the focus trap,
 * focus restoration, Escape handling and scroll lock rather than reimplementing
 * four of them badly in a floating panel.
 *
 * Two details that matter more than they look:
 *
 *  - **The current path is sent with the report.** "The page I was on" is most
 *    of the diagnostic value and the reporter should not have to describe it.
 *  - **A failure keeps the modal open with the text intact.** The message is
 *    the user's own words; closing on error would discard them, and a person
 *    who loses a paragraph of considered feedback does not write it twice.
 */
export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (sending || message.trim().length < 3) return;

    setSending(true);
    setError(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, message, path: pathname }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not send your feedback.');
      }

      setSent(true);
      setMessage('');
    } catch (err) {
      // Modal stays open, text stays in the box.
      setError(err instanceof Error ? err.message : 'Could not send your feedback.');
    } finally {
      setSending(false);
    }
  }

  function close() {
    setOpen(false);
    setError(null);
    setSent(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-content-secondary transition-colors duration-micro hover:bg-surface-raised hover:text-content"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
        Feedback
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Send feedback"
        description="It reaches the people who work on this. Include what you expected to happen."
        size="md"
        footer={
          sent ? (
            <Button onClick={close}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} loading={sending} disabled={message.trim().length < 3}>
                Send
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <p role="status" className="text-sm leading-6 text-content-secondary">
            Sent — thank you. We read all of it, and we read the ones that say what you expected first.
          </p>
        ) : (
          <div className="space-y-4">
            <Select
              label="What kind of feedback is it?"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="bug">Something is broken</option>
              <option value="confusing">Something is confusing</option>
              <option value="idea">I have an idea</option>
              <option value="praise">Something works well</option>
              <option value="other">Something else</option>
            </Select>

            <Textarea
              label="What happened?"
              hint={`Sent with the page you are on (${pathname}).`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={4000}
              error={error}
              required
            />
          </div>
        )}
      </Modal>
    </>
  );
}
