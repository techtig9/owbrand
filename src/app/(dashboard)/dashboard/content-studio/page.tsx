'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Camera, Loader2 } from 'lucide-react';

const TYPES = [
  { id: 'photo', label: 'Photo', cost: 150 },
  { id: 'post', label: 'Social post', cost: 150 },
  { id: 'logo', label: 'Logo', cost: 300 },
  { id: 'content', label: 'Copy', cost: 100 },
] as const;

export default function ContentStudioPage() {
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [brandId, setBrandId] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]['id']>('post');
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/billing/subscription-status').catch(() => {}); // warms auth session, ignored
  }, []);

  async function handleGenerate() {
    if (!brandId) {
      toast.error('Select a brand first — generate one in the AI Generator if you haven\u2019t yet.');
      return;
    }
    if (!instruction.trim()) {
      toast.error('Describe what you want generated.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, type, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Generation failed.');
        return;
      }
      setAssets((prev) => [{ ...data.asset, spec: data.spec }, ...prev]);
      toast.success('Generated.');
    } catch {
      toast.error('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Content Studio</h1>
        <p className="mt-1 text-sm text-ink-soft">Paid plans only — keep your brand's content fresh from here.</p>
      </div>

      <div className="glass-panel space-y-5 p-6">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-soft">Brand ID</span>
          <input
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            placeholder="Paste a brand ID from Projects"
            className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm focus:border-coral-400"
          />
        </label>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-soft">Asset type</p>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium ${
                  type === t.id ? 'border-ink bg-ink text-canvas' : 'border-line bg-white text-ink-soft'
                }`}
              >
                {t.label} · {t.cost}cr
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-soft">What do you want?</span>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="e.g. A cozy autumn product shot for our candle line"
            className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm focus:border-coral-400"
          />
        </label>

        <button type="button" onClick={handleGenerate} disabled={loading} className="btn-accent w-full disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {assets.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-2xl border border-line bg-white p-5">
              <span className="rounded-full bg-canvas-alt px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-soft">
                {asset.type}
              </span>
              <p className="mt-3 text-sm text-ink-soft">{asset.caption ?? asset.spec?.text ?? 'No caption'}</p>
              <p className="mt-2 text-[10px] text-ink-faint">Status: {asset.status}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
