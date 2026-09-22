/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalInbox } from '@/components/approvals/ApprovalInbox';

/**
 * The approval inbox, rendered.
 *
 * The rule under test is the one that carries risk: a reviewer must not be able
 * to approve content with BLOCKING factuality findings in a single click. The
 * server enforces it too, but a UI that fires the request anyway would mean the
 * only thing standing between a flagged medical claim and publication is an
 * error toast.
 */

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const BLOCKED_ITEM = {
  asset: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    brandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    type: 'ad',
    status: 'pending_approval',
    caption: 'Clinically proven to cure eczema in 3 days.',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  findings: [
    {
      id: 'f1',
      severity: 'block' as const,
      category: 'medical_claim',
      excerpt: 'clinically proven to cure',
      explanation: 'Asserts a medical outcome with no approved product fact behind it.',
    },
  ],
  blocked: true,
};

const ADVISORY_ITEM = {
  ...BLOCKED_ITEM,
  asset: { ...BLOCKED_ITEM.asset, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', caption: 'The best serum around.' },
  findings: [
    {
      id: 'f2',
      severity: 'review' as const,
      category: 'superlative',
      excerpt: 'the best',
      explanation: 'Unqualified superlative — check it is defensible.',
    },
  ],
  blocked: false,
};

function mockInbox(items: unknown[]) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (!init || init.method === undefined || init.method === 'GET') {
      return new Response(
        JSON.stringify({
          items,
          counts: {
            pending: items.length,
            blocked: items.filter((i) => (i as { blocked: boolean }).blocked).length,
            review: items.filter((i) => !(i as { blocked: boolean }).blocked).length,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe('ApprovalInbox', () => {
  it('shows the empty state when nothing is waiting', async () => {
    mockInbox([]);
    render(<ApprovalInbox />);
    expect(await screen.findByText(/nothing waiting/i)).toBeTruthy();
  });

  it('renders the finding excerpt and explanation, not just a count', async () => {
    mockInbox([BLOCKED_ITEM]);
    render(<ApprovalInbox />);

    // A reviewer cannot judge "1 blocking finding" — they need the words.
    // Matched exactly, with the quote marks the finding block adds: the asset
    // caption contains the same phrase, and a loose regex would pass on the
    // caption alone even if the excerpt were never rendered.
    expect(await screen.findByText('\u201cclinically proven to cure\u201d')).toBeTruthy();
    expect(screen.getByText(/no approved product fact/i)).toBeTruthy();
    expect(screen.getByText(/medical claim/i)).toBeTruthy();
  });

  it('disables Approve on a blocked item until the reviewer acknowledges', async () => {
    mockInbox([BLOCKED_ITEM]);
    render(<ApprovalInbox />);

    const approve = await screen.findByRole('button', { name: /approve/i });
    expect((approve as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('checkbox'));
    expect((approve as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not POST anything while Approve is still gated', async () => {
    const fetchMock = mockInbox([BLOCKED_ITEM]);
    render(<ApprovalInbox />);

    const approve = await screen.findByRole('button', { name: /approve/i });
    await userEvent.click(approve);

    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(0);
    // And the item is still in the queue, unresolved.
    expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy();
  });

  it('sends the decision with resolveFindings once acknowledged', async () => {
    const fetchMock = mockInbox([BLOCKED_ITEM]);
    render(<ApprovalInbox />);

    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    // Wait for the settled outcome — the resolved item leaves the queue —
    // rather than for the request alone, so no state update lands after the
    // test ends.
    await waitFor(() => expect(screen.queryByRole('button', { name: /approve/i })).toBeNull());

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(post).toBeDefined();
    expect(JSON.parse((post![1] as RequestInit).body as string)).toMatchObject({
      assetId: BLOCKED_ITEM.asset.id,
      decision: 'approve',
      resolveFindings: true,
    });
  });

  it('never gates an advisory-only item — there is no checkbox to tick', async () => {
    mockInbox([ADVISORY_ITEM]);
    render(<ApprovalInbox />);

    const approve = await screen.findByRole('button', { name: /approve/i });
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('lets a blocked item be rejected without acknowledging anything', async () => {
    // Rejecting publishes nothing, so gating it would trap flagged content.
    const fetchMock = mockInbox([BLOCKED_ITEM]);
    render(<ApprovalInbox />);

    await userEvent.click(await screen.findByRole('button', { name: /reject/i }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /reject/i })).toBeNull());

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post![1] as RequestInit).body as string).decision).toBe('reject');
  });

  it('surfaces a load failure instead of showing an empty queue', async () => {
    // An empty inbox and a broken inbox must not look identical — that is how
    // a reviewer concludes there is nothing to approve when there is.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Database unavailable.' }), { status: 503 }))
    );

    render(<ApprovalInbox />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/database unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/nothing waiting/i)).toBeNull();
  });

  it('scopes the request to a brand when one is given', async () => {
    const fetchMock = mockInbox([]);
    render(<ApprovalInbox brandId={BLOCKED_ITEM.asset.brandId} />);

    // Awaiting the settled UI as well, not just the request: ending the test
    // mid-load leaves a state update to land after teardown, which React
    // reports as an act() warning and which would mask a real one later.
    expect(await screen.findByText(/nothing waiting/i)).toBeTruthy();
    expect(String(fetchMock.mock.calls[0][0])).toContain(`brandId=${BLOCKED_ITEM.asset.brandId}`);
  });
});
