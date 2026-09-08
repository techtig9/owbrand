/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreativeStudio } from '@/components/creative/CreativeStudio';

/**
 * The Creative Studio, rendered.
 *
 * Two behaviours are worth a DOM: that switching tools actually changes which
 * endpoint gets called (the defect this screen was rewritten to fix), and that
 * a tool whose provider has no credentials refuses locally instead of letting
 * the user spend credits on a request that cannot succeed.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BRAND = { id: '11111111-1111-4111-8111-111111111111', name: 'Aurea' };

const ALL_AVAILABLE = { ai: true, image: true, video: true };

function mockApi(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);

    if (href.startsWith('/api/products')) {
      return new Response(JSON.stringify({ products: [], assets: [] }), { status: 200 });
    }

    return new Response(
      JSON.stringify({
        variations: [
          {
            headline: 'Barrier first',
            body: 'A serum that respects your skin.',
            cta: 'Shop now',
            hashtags: ['skincare'],
            rationale: 'Leads with the benefit.',
            factuality: { findings: [], blocked: false },
          },
        ],
        requiresReview: false,
        creditsRemaining: 41,
        generation: { provider: 'anthropic', model: 'claude-opus-5', attempts: 1, viaFallback: false },
        ...overrides,
      }),
      { status: 201 }
    );
  });

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => cleanup());

/**
 * The brief textarea. `getByRole('textbox')` is ambiguous here: the settings
 * panel carries a Platform input on the copy tool.
 */
function brief() {
  return screen.getByPlaceholderText(/launch|reel/i);
}

describe('CreativeStudio', () => {
  it('offers every tool', async () => {
    mockApi();
    render(<CreativeStudio brands={[BRAND]} initialBrandId={BRAND.id} capabilities={ALL_AVAILABLE} />);

    for (const label of ['Copy', 'Reel script', 'Product photo', 'Product video']) {
      expect(screen.getByRole('tab', { name: new RegExp(label, 'i') })).toBeTruthy();
    }
  });

  it('posts copy to the copy endpoint and renders the result as text, not JSON', async () => {
    const fetchMock = mockApi();
    render(<CreativeStudio brands={[BRAND]} initialBrandId={BRAND.id} capabilities={ALL_AVAILABLE} />);

    await userEvent.type(brief(), 'Launch post for the serum');
    await userEvent.click(screen.getByRole('button', { name: /generate copy/i }));

    await waitFor(() => expect(screen.getByText('Barrier first')).toBeTruthy());

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(String(post![0])).toBe('/api/ai/generate-content');

    // The old studio printed JSON.stringify(result) — the giveaway is a raw
    // key name reaching the DOM.
    expect(document.body.textContent).not.toContain('"variations"');
    expect(document.body.textContent).not.toContain('viaFallback');
  });

  it('routes the reel tool to the reel endpoint, not the copy endpoint', async () => {
    const fetchMock = mockApi({
      variations: undefined,
      script: {
        concept: 'Serum, three shots.',
        hook: 'Your barrier is thirsty.',
        durationSeconds: 15,
        aspectRatio: '9:16',
        scenes: [
          {
            order: 1,
            durationSeconds: 5,
            visual: 'Bottle on travertine.',
            onScreenText: 'Barrier first',
            voiceover: 'Start here.',
            sourceAssetIndex: null,
            transition: 'cut',
          },
          {
            order: 2,
            durationSeconds: 10,
            visual: 'Hands applying.',
            onScreenText: '',
            voiceover: '',
            sourceAssetIndex: null,
            transition: 'fade',
          },
        ],
        caption: 'Meet the serum.',
        hashtags: [],
        cta: 'Shop now',
        musicDirection: 'Warm lo-fi',
      },
      factuality: { findings: [], blocked: false },
      renderState: 'not_rendered',
    });
    render(<CreativeStudio brands={[BRAND]} initialBrandId={BRAND.id} capabilities={ALL_AVAILABLE} />);

    await userEvent.click(screen.getByRole('tab', { name: /reel script/i }));
    await userEvent.type(brief(), 'A 15-second launch reel');
    await userEvent.click(screen.getByRole('button', { name: /generate reel script/i }));

    // Wait for the shot list itself, so the assertion covers the render too.
    await waitFor(() => expect(screen.getByText(/your barrier is thirsty/i)).toBeTruthy());
    expect(screen.getByText(/not rendered/i)).toBeTruthy();

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(String(post![0])).toBe('/api/ai/generate-reel');
  });

  it('refuses locally when the image provider has no credentials', async () => {
    const fetchMock = mockApi();
    render(
      <CreativeStudio
        brands={[BRAND]}
        initialBrandId={BRAND.id}
        capabilities={{ ai: true, image: false, video: true }}
      />
    );

    await userEvent.click(screen.getByRole('tab', { name: /product photo/i }));

    expect(screen.getByRole('note').textContent).toMatch(/not configured/i);
    // Names the variables an operator has to set — not a dead end.
    expect(screen.getByText(/IMAGE_PROVIDER_URL/)).toBeTruthy();

    const generate = screen.getByRole('button', { name: /generate product photo/i });
    expect((generate as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(generate);
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  it('gates the media tools on their own credential, not the text model', async () => {
    // A server with a Claude key but no image key must not present photo as ready.
    mockApi();
    render(
      <CreativeStudio
        brands={[BRAND]}
        initialBrandId={BRAND.id}
        capabilities={{ ai: true, image: false, video: false }}
      />
    );

    // Copy stays available.
    expect(screen.queryByRole('note')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /product video/i }));
    expect(screen.getByText(/VIDEO_PROVIDER_URL/)).toBeTruthy();
  });

  it('explains what is missing instead of leaving a dead button', async () => {
    mockApi();
    render(<CreativeStudio brands={[BRAND]} initialBrandId={BRAND.id} capabilities={ALL_AVAILABLE} />);

    expect((screen.getByRole('button', { name: /generate copy/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/describe what you want/i)).toBeTruthy();

    await userEvent.type(brief(), 'Launch post');
    expect((screen.getByRole('button', { name: /generate copy/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('surfaces a blocking factuality finding on the generated copy', async () => {
    mockApi({
      variations: [
        {
          headline: 'Cures eczema',
          body: 'Clinically proven.',
          cta: '',
          hashtags: [],
          rationale: '',
          factuality: {
            findings: [
              {
                severity: 'block',
                category: 'medical_claim',
                excerpt: 'clinically proven',
                explanation: 'No approved product fact supports this.',
              },
            ],
            blocked: true,
          },
        },
      ],
      requiresReview: true,
    });

    render(<CreativeStudio brands={[BRAND]} initialBrandId={BRAND.id} capabilities={ALL_AVAILABLE} />);
    await userEvent.type(brief(), 'Write an ad');
    await userEvent.click(screen.getByRole('button', { name: /generate copy/i }));

    // The writer must see the finding here, not only in the approvals queue —
    // otherwise they copy the blocked claim straight out of the studio.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/held for review/i);
    expect(alert.textContent).toMatch(/no approved product fact/i);
  });

  it('reports an unexpected response instead of crashing the page', async () => {
    // Regression: feeding a copy-shaped payload to the reel tool used to reach
    // ReelResult, which read `script.scenes` and took the whole studio down.
    mockApi();
    render(<CreativeStudio brands={[BRAND]} initialBrandId={BRAND.id} capabilities={ALL_AVAILABLE} />);

    await userEvent.click(screen.getByRole('tab', { name: /reel script/i }));
    await userEvent.type(brief(), 'A 15-second launch reel');
    await userEvent.click(screen.getByRole('button', { name: /generate reel script/i }));

    // The studio is still standing and the tool rail still works.
    await waitFor(() => expect(screen.getByRole('tab', { name: /reel script/i })).toBeTruthy());
    expect(screen.queryByText(/not rendered/i)).toBeNull();
  });
});
