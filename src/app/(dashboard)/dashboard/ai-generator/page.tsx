'use client';
import { useState } from 'react';
import { Wand2, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
export default function AIGeneratorPage() {
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [industry, setIndustry] = useState(''),
    [loading, setLoading] = useState(false),
    [result, setResult] = useState<any>(null);
  async function build() {
    if (name.trim().length < 2 || description.trim().length < 20)
      return toast.error('Give OwBrand a name and a useful business description.');
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch('/api/ai/build-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName: name, description, industry }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setResult(d);
      toast.success('Brand Brain created.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Brand build failed.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <div>
        <p className="section-eyebrow">Phase 1 · Brand intelligence</p>
        <h1 className="mt-3 font-display text-3xl font-bold">Build My Brand</h1>
        <p className="mt-2 max-w-2xl text-sm text-content-secondary">
          Describe the business once. OwBrand turns the description into the structured Brand Brain used by
          products, content, campaigns and analytics.
        </p>
      </div>
      <div className="glass-panel p-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-xs font-medium text-content-secondary">Brand name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Noor Skin"
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm"
            />
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-medium text-content-secondary">Industry</span>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. skincare, fashion, SaaS"
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-content-secondary">
            Tell OwBrand everything you know
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={9}
            placeholder="What do you sell? Who is it for? Where will you sell? What makes it different? Price range? Brand feeling? Goals? Competitors?"
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm"
          />
        </label>
        <button onClick={build} disabled={loading} className="btn-accent w-full">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {loading ? 'Building your Brand Brain...' : 'Build My Brand'}
        </button>
      </div>
      {result && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-primary bg-primary-subtle p-5">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-5 w-5" /> Brand Brain created
            </div>
            <p className="mt-1 text-sm text-content-secondary">
              Open Brand Brain to review the decisions that will guide future AI generations.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="glass-panel p-5">
              <p className="text-xs uppercase text-content-tertiary">USP</p>
              <p className="mt-2 text-sm leading-6">{result.brain?.positioning?.usp || '—'}</p>
            </div>
            <div className="glass-panel p-5">
              <p className="text-xs uppercase text-content-tertiary">Tagline</p>
              <p className="mt-2 text-sm leading-6">{result.brain?.identity?.tagline || '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
