'use client';
import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
export default function Campaigns() {
  const [brands, setBrands] = useState<any[]>([]),
    [brandId, setBrandId] = useState(''),
    [campaigns, setCampaigns] = useState<any[]>([]),
    [name, setName] = useState(''),
    [objective, setObjective] = useState('sales'),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  /*
   * Loads the brand list and selects one. It deliberately does NOT fetch
   * campaigns: setting brandId triggers the effect below, and the previous
   * version did both, so every first load fetched the campaign list twice.
   *
   * Wrapped in useCallback so it can be an honest effect dependency. The
   * lint warning this clears was pointing at a real staleness hazard, not
   * just ceremony.
   */
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/brands');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load your brands.');

      setBrands(body.brands || []);
      const id = brandId || body.brands?.[0]?.id;
      if (id) setBrandId(id);
    } catch (err) {
      // Previously a floating promise with no catch: a failed request left the
      // page empty with no explanation and no way to retry.
      setError(err instanceof Error ? err.message : 'Could not load your brands.');
    }
  }, [brandId]);

  useEffect(() => {
    void load();
    // Intentionally mount-only: `load` depends on brandId, and re-running it
    // when brandId changes would reselect the first brand and fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/campaigns?brandId=${encodeURIComponent(brandId)}`);
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error ?? 'Could not load campaigns.');
        setCampaigns(body.campaigns || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load campaigns.');
      }
    })();

    // Guards against a slow response for an old brand overwriting a newer one.
    return () => {
      cancelled = true;
    };
  }, [brandId]);
  async function add() {
    if (!name.trim()) return toast.error('Give the campaign a name.');
    setLoading(true);
    try {
      const r = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, name, objective }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCampaigns((c) => [d.campaign, ...c]);
      setName('');
      toast.success('Campaign created.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create campaign');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="section-eyebrow">Marketing engine</p>
          <h1 className="mt-3 font-display text-3xl font-bold">Campaigns</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Turn a business goal into a connected plan for social, ads, email and landing pages.
          </p>
        </div>
        {brands.length > 0 && (
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="h-fit rounded-xl border border-line bg-surface px-4 py-2.5 text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
        <section className="glass-panel p-6">
          <h2 className="font-display text-lg font-semibold">New campaign</h2>
          <div className="mt-5 space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer launch"
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm"
            />
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm"
            >
              <option value="awareness">Awareness</option>
              <option value="traffic">Traffic</option>
              <option value="leads">Leads</option>
              <option value="sales">Sales</option>
            </select>
            <button onClick={add} disabled={loading} className="btn-accent w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create
              campaign
            </button>
          </div>
        </section>
        <section className="space-y-3">
          {campaigns.map((c) => (
            <article key={c.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="rounded-xl bg-surface-raised p-2">
                    <Megaphone className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display font-semibold">{c.name}</h3>
                    <p className="text-xs text-content-tertiary">
                      {c.objective} · {c.status}
                    </p>
                  </div>
                </div>
                <button className="btn-ghost !px-4 !py-2 text-xs">Plan with AI</button>
              </div>
            </article>
          ))}
          {campaigns.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-sm text-content-secondary">
              No campaigns yet.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
