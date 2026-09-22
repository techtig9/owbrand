'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Card, Input, Select, Textarea } from '@/components/ui';

const TOPICS = [
  { value: 'support', label: 'Something is not working' },
  { value: 'sales', label: 'Questions before signing up' },
  { value: 'security', label: 'Security' },
  { value: 'privacy', label: 'Privacy or data' },
  { value: 'other', label: 'Something else' },
];

/**
 * The contact form.
 *
 * The spam protection is deliberately invisible to a real sender: a honeypot
 * field and a dwell-time measurement, no CAPTCHA. A CAPTCHA costs every
 * legitimate person real effort, fails disproportionately for people using
 * assistive technology, and is defeated by the solving services commercial
 * spammers already pay for.
 *
 * The honeypot is hidden with `aria-hidden` AND `tabIndex={-1}` AND positioned
 * off-screen rather than `display:none` — some form-fillers skip hidden
 * fields, and some screen readers would otherwise announce it. Off-screen with
 * aria-hidden is invisible to both a person and a reader, and still present
 * for a naive bot.
 */
export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('support');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set on mount, so "how long was this form open" is measured rather than
  // asserted by the client at submit time.
  const openedAt = useRef<number>(Date.now());
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/public/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          topic,
          message,
          website,
          elapsedMs: Date.now() - openedAt.current,
        }),
      });
      const body = await response.json().catch(() => null);

      if (response.status === 429) {
        const wait = body?.details?.retryAfterSeconds;
        throw new Error(
          wait
            ? `Too many messages from here. Try again in ${Math.ceil(wait / 60)} minute(s).`
            : 'Too many messages from here. Try again shortly.'
        );
      }

      if (!response.ok) throw new Error(body?.error ?? 'Could not send that message.');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Card className="p-8">
        <h2 className="text-base font-semibold text-content">Message sent</h2>
        <p className="mt-2 text-sm leading-6 text-content-secondary">
          A real person reads these. If you asked something that needs an answer, you will get one —
          and if the question turns out to be a common one, it ends up in the help centre.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={submit} noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            autoComplete="name"
            required
          />
          <Input
            label="Email"
            type="email"
            hint="So we can reply."
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={160}
            autoComplete="email"
            required
          />
        </div>

        <div className="mt-5">
          <Select
            label="What is this about?"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          >
            {TOPICS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-5">
          <Textarea
            label="Message"
            hint="At least 20 characters. Specifics help more than politeness."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={6}
            minLength={20}
            maxLength={4000}
            required
          />
        </div>

        {/*
          The honeypot. Off-screen rather than display:none, aria-hidden so no
          screen reader announces it, and tabIndex -1 so it is unreachable by
          keyboard. A person cannot fill this in; a naive form-filler will.
        */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="contact-website">Website (leave blank)</label>
          <input
            id="contact-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="mt-5 rounded-md bg-danger-subtle px-3 py-2 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <div className="mt-6">
          <Button
            type="submit"
            loading={sending}
            disabled={name.length === 0 || email.length === 0 || message.trim().length < 20}
            icon={<Send className="h-4 w-4" />}
          >
            Send message
          </Button>
        </div>
      </form>
    </Card>
  );
}
