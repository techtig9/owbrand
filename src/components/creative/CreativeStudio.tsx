'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Film, Loader2, Megaphone, Sparkles, Video } from 'lucide-react';
import { toast } from 'sonner';
import { CopyResult } from './CopyResult';
import { ReelResult } from './ReelResult';
import { MediaJobResult } from './MediaJobResult';
import {
  COPY_KINDS,
  INITIAL_CREATIVE_FORM,
  TOOL_CAPABILITY,
  creativeRequestFor,
  isExpectedShape,
  missingRequirement,
  type CreativeFormState,
  type ToolId,
} from '@/lib/creative/requests';
import type {
  BrandOption,
  CopyResponse,
  MediaJobResponse,
  ProductAssetOption,
  ProductOption,
  ReelResponse,
  StudioCapabilities,
} from './types';

/**
 * The Creative Studio.
 *
 * What this replaces: the previous studio had four "modes" that all POSTed to
 * `/api/ai/generate-content` with the mode name prepended to the instruction
 * string — so "Product photo brief" produced text, "Reel script" produced text,
 * and `/api/creative/photo`, `/api/creative/video` and `/api/ai/generate-reel`
 * were unreachable from the product. Output was `JSON.stringify(result)`.
 *
 * Each tool now calls the endpoint that actually does its job, renders the
 * result as the thing it is, and reports provider capability honestly: when
 * image or video credentials are absent the tool says so and does not let the
 * user spend credits on a call that must fail.
 */

const TOOLS: Array<{ id: ToolId; label: string; icon: typeof Sparkles; blurb: string }> = [
  { id: 'copy', label: 'Copy', icon: Megaphone, blurb: 'Brand-consistent posts, ads, emails and headlines.' },
  { id: 'reel', label: 'Reel script', icon: Film, blurb: 'Hook, shot list, voiceover and caption.' },
  { id: 'photo', label: 'Product photo', icon: Camera, blurb: 'New scenes from a photo of your product.' },
  { id: 'video', label: 'Product video', icon: Video, blurb: 'Short-form video rendered from your assets.' },
];


type Result =
  | { tool: 'copy'; data: CopyResponse }
  | { tool: 'reel'; data: ReelResponse }
  | { tool: 'photo'; data: MediaJobResponse }
  | { tool: 'video'; data: MediaJobResponse };

export function CreativeStudio({
  brands,
  initialBrandId,
  capabilities,
}: {
  brands: BrandOption[];
  initialBrandId: string;
  capabilities: StudioCapabilities;
}) {
  const [tool, setTool] = useState<ToolId>('copy');
  const [brandId, setBrandId] = useState(initialBrandId);
  const [form, setForm] = useState<CreativeFormState>(INITIAL_CREATIVE_FORM);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [assets, setAssets] = useState<ProductAssetOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const activeTool = TOOLS.find((t) => t.id === tool)!;
  const available = capabilities[TOOL_CAPABILITY[tool]];

  const update = useCallback(<K extends keyof CreativeFormState>(key: K, value: CreativeFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  // Products for the selected brand. The endpoint asserts brand access, so a
  // failure here is a genuine authorization result, not something to swallow.
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/products?brandId=${encodeURIComponent(brandId)}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error ?? 'Could not load products.');
        setProducts(data.products ?? []);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Could not load products.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brandId]);

  // Assets for the selected product — photo and video need a real source image.
  useEffect(() => {
    if (!brandId || !form.productId) {
      setAssets([]);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/products?brandId=${encodeURIComponent(brandId)}&productId=${encodeURIComponent(form.productId)}`
        );
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error ?? 'Could not load product assets.');
        setAssets(data.assets ?? []);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Could not load product assets.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brandId, form.productId]);

  /** Everything the tool needs before the button does anything. */
  const missing = useMemo(() => missingRequirement(tool, brandId, form), [tool, brandId, form]);

  async function generate() {
    if (missing) {
      toast.error(missing);
      return;
    }

    setLoading(true);
    setResult(null);

    const { endpoint, payload } = creativeRequestFor(tool, brandId, form);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Generation failed.');

      // Guard the render: a payload that does not match the tool would
      // otherwise reach a result component that indexes into it and take the
      // page down with an unhandled TypeError.
      if (!isExpectedShape(tool, data)) {
        throw new Error('The server returned an unexpected response. Nothing was saved to your library.');
      }

      setResult({ tool, data } as Result);

      if (tool === 'copy' || tool === 'reel') {
        toast.success(data.requiresReview ? 'Generated — held for review.' : 'Generated.');
      } else {
        toast.success(data.state === 'completed' ? 'Generated.' : 'Submitted — rendering.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Generation failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
      <ToolRail tool={tool} onSelect={setTool} capabilities={capabilities} />

      <section className="min-w-0 space-y-5">
        <div className="glass-panel p-6">
          <div className="flex flex-wrap items-center gap-3">
            {brands.length > 1 && (
              <label className="text-xs font-medium text-ink-soft">
                <span className="mb-1 block">Brand</span>
                <select
                  value={brandId}
                  onChange={(event) => {
                    setBrandId(event.target.value);
                    setForm((current) => ({ ...current, productId: '', sourceAssetId: '', sourceAssetIds: [] }));
                  }}
                  className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink"
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-xs text-ink-soft">{activeTool.blurb}</p>
          </div>

          {!available && <CapabilityNotice needs={TOOL_CAPABILITY[tool]} />}

          <div className={!available ? 'pointer-events-none mt-5 opacity-50' : 'mt-5'}>
            <ToolForm
              tool={tool}
              form={form}
              update={update}
              products={products}
              assets={assets}
            />
          </div>

          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading || !available || Boolean(missing)}
            className="btn-accent mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            {loading ? 'Working…' : `Generate ${activeTool.label.toLowerCase()}`}
          </button>

          {/* Say what is missing instead of leaving a dead button. */}
          {available && missing && <p className="mt-2 text-center text-xs text-ink-faint">{missing}</p>}
        </div>

        {result?.tool === 'copy' && <CopyResult result={result.data} />}
        {result?.tool === 'reel' && <ReelResult result={result.data} />}
        {result?.tool === 'photo' && <MediaJobResult initial={result.data} kind="photo" />}
        {result?.tool === 'video' && <MediaJobResult initial={result.data} kind="video" />}
      </section>

      <SettingsPanel tool={tool} form={form} update={update} />
    </div>
  );
}

function ToolRail({
  tool,
  onSelect,
  capabilities,
}: {
  tool: ToolId;
  onSelect: (tool: ToolId) => void;
  capabilities: StudioCapabilities;
}) {
  return (
    <aside className="glass-panel h-fit p-4">
      <p className="px-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Create</p>
      <div className="mt-3 space-y-1" role="tablist" aria-label="Creative tools">
        {TOOLS.map(({ id, label, icon: Icon }) => {
          const active = tool === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                active ? 'bg-ink text-canvas' : 'text-ink-soft hover:bg-canvas-alt hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1 text-left">{label}</span>
              {/* An unconfigured tool is still selectable — the panel explains
                  what is missing, which is more useful than a hidden feature. */}
              {!capabilities[TOOL_CAPABILITY[id]] && (
                <span className="rounded-full bg-canvas-alt px-2 py-0.5 text-[9px] font-bold uppercase text-ink-faint">
                  setup
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function CapabilityNotice({ needs }: { needs: 'ai' | 'image' | 'video' }) {
  const label =
    needs === 'image' ? 'image generation' : needs === 'video' ? 'video generation' : 'the text model';
  // Names the exact variables lib/env.ts checks, so "not configured" is
  // actionable rather than a dead end.
  const envVars =
    needs === 'image'
      ? 'IMAGE_PROVIDER_URL and IMAGE_PROVIDER_API_KEY'
      : needs === 'video'
        ? 'VIDEO_PROVIDER_URL and VIDEO_PROVIDER_API_KEY'
        : 'ANTHROPIC_API_KEY';

  return (
    <div role="note" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Not configured</p>
      <p className="mt-1 text-xs leading-5 text-ink-soft">
        This server has no credentials for {label}, so the request would fail. Set{' '}
        <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">{envVars}</code> and restart. Nothing
        is charged while it is unconfigured.
      </p>
    </div>
  );
}

function ToolForm({
  tool,
  form,
  update,
  products,
  assets,
}: {
  tool: ToolId;
  form: CreativeFormState;
  update: <K extends keyof CreativeFormState>(key: K, value: CreativeFormState[K]) => void;
  products: ProductOption[];
  assets: ProductAssetOption[];
}) {
  const needsProduct = tool === 'photo' || tool === 'video';

  return (
    <div className="space-y-4">
      {(needsProduct || tool === 'copy') && (
        <Field label={needsProduct ? 'Product' : 'Product (optional — scopes approved facts)'}>
          <select
            value={form.productId}
            onChange={(event) => {
              update('productId', event.target.value);
              update('sourceAssetId', '');
              update('sourceAssetIds', []);
            }}
            className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink"
          >
            <option value="">{needsProduct ? 'Select a product…' : 'No specific product'}</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          {needsProduct && products.length === 0 && (
            <p className="mt-1 text-xs text-ink-faint">
              No products yet — add one under Products, with at least one photo.
            </p>
          )}
        </Field>
      )}

      {tool === 'photo' && (
        <>
          <Field label="Source photo">
            <AssetPicker
              assets={assets}
              selected={form.sourceAssetId ? [form.sourceAssetId] : []}
              onToggle={(id) => update('sourceAssetId', id)}
              multiple={false}
            />
          </Field>
          <Field label="Style">
            <input
              value={form.style}
              onChange={(event) => update('style', event.target.value)}
              placeholder="Editorial, soft daylight, warm neutrals"
              className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink"
            />
          </Field>
          <Field label="Scene">
            <input
              value={form.scene}
              onChange={(event) => update('scene', event.target.value)}
              placeholder="On a travertine ledge beside a linen towel"
              className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink"
            />
          </Field>
        </>
      )}

      {tool === 'video' && (
        <>
          <Field label="Source assets">
            <AssetPicker
              assets={assets}
              selected={form.sourceAssetIds}
              onToggle={(id) =>
                update(
                  'sourceAssetIds',
                  form.sourceAssetIds.includes(id)
                    ? form.sourceAssetIds.filter((existing) => existing !== id)
                    : [...form.sourceAssetIds, id].slice(0, 6)
                )
              }
              multiple
            />
          </Field>
          <Field label="Style">
            <input
              value={form.style}
              onChange={(event) => update('style', event.target.value)}
              placeholder="Fast cuts, handheld, natural light"
              className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink"
            />
          </Field>
          <Field label="Goal">
            <input
              value={form.goal}
              onChange={(event) => update('goal', event.target.value)}
              placeholder="Drive first-time trial of the serum"
              className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink"
            />
          </Field>
        </>
      )}

      {(tool === 'copy' || tool === 'reel') && (
        <Field label="Brief">
          <textarea
            value={form.instruction}
            onChange={(event) => update('instruction', event.target.value)}
            rows={7}
            maxLength={1500}
            placeholder={
              tool === 'reel'
                ? 'A 15-second launch reel for the vitamin C serum. Premium feel, strong first-second hook, clear CTA.'
                : 'A launch announcement for the vitamin C serum. Confident, not shouty. One clear benefit.'
            }
            className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm leading-6 text-ink"
          />
          <p className="mt-1 text-right text-[11px] text-ink-faint tabular-nums">
            {form.instruction.length}/1500
          </p>
        </Field>
      )}
    </div>
  );
}

/**
 * Picks source assets by thumbnail.
 *
 * `product_assets.url` is whatever the uploader or provider stored. Rendering
 * it in a plain <img> is deliberate — see MediaJobResult for why next/image is
 * not used for provider-hosted media.
 */
function AssetPicker({
  assets,
  selected,
  onToggle,
  multiple,
}: {
  assets: ProductAssetOption[];
  selected: string[];
  onToggle: (id: string) => void;
  multiple: boolean;
}) {
  if (assets.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-canvas-alt px-4 py-6 text-center text-xs text-ink-faint">
        No assets on this product yet. Upload a product photo first.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Source assets">
      {assets.map((asset) => {
        const isSelected = selected.includes(asset.id);
        return (
          <button
            key={asset.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(asset.id)}
            className={`overflow-hidden rounded-xl border-2 transition-colors ${
              isSelected ? 'border-ink' : 'border-transparent hover:border-line'
            }`}
          >
            {asset.url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={asset.url} alt="" className="aspect-square w-full bg-canvas-alt object-cover" />
            ) : (
              <span className="grid aspect-square w-full place-items-center bg-canvas-alt text-[10px] text-ink-faint">
                {asset.type}
              </span>
            )}
          </button>
        );
      })}
      {multiple && <p className="col-span-4 text-[11px] text-ink-faint">{selected.length}/6 selected</p>}
    </div>
  );
}

/** The properties panel — format decisions, kept out of the brief. */
function SettingsPanel({
  tool,
  form,
  update,
}: {
  tool: ToolId;
  form: CreativeFormState;
  update: <K extends keyof CreativeFormState>(key: K, value: CreativeFormState[K]) => void;
}) {
  return (
    <aside className="glass-panel h-fit space-y-4 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Settings</p>

      {tool === 'copy' && (
        <>
          <Field label="Format">
            <select
              value={form.kind}
              onChange={(event) => update('kind', event.target.value as CreativeFormState['kind'])}
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
            >
              {COPY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Platform (optional)">
            <input
              value={form.platform}
              onChange={(event) => update('platform', event.target.value)}
              maxLength={40}
              placeholder="instagram"
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label={`Versions: ${form.variations}`}>
            <input
              type="range"
              min={1}
              max={5}
              value={form.variations}
              onChange={(event) => update('variations', Number(event.target.value))}
              className="w-full"
            />
          </Field>
        </>
      )}

      {(tool === 'reel' || tool === 'video') && (
        <>
          <Field label="Duration">
            <div className="flex gap-2">
              {([15, 30, 60] as const).map((seconds) => (
                <Chip
                  key={seconds}
                  active={form.durationSeconds === seconds}
                  onClick={() => update('durationSeconds', seconds)}
                >
                  {seconds}s
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Aspect ratio">
            <div className="flex gap-2">
              {(['9:16', '1:1', '16:9'] as const).map((ratio) => (
                <Chip key={ratio} active={form.reelAspect === ratio} onClick={() => update('reelAspect', ratio)}>
                  {ratio}
                </Chip>
              ))}
            </div>
          </Field>
        </>
      )}

      {tool === 'photo' && (
        <>
          <Field label="Aspect ratio">
            <div className="flex flex-wrap gap-2">
              {(['1:1', '4:5', '3:2', '16:9', '9:16'] as const).map((ratio) => (
                <Chip key={ratio} active={form.photoAspect === ratio} onClick={() => update('photoAspect', ratio)}>
                  {ratio}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label={`Images: ${form.count}`}>
            <input
              type="range"
              min={1}
              max={6}
              value={form.count}
              onChange={(event) => update('count', Number(event.target.value))}
              className="w-full"
            />
          </Field>
        </>
      )}

      <p className="border-t border-line pt-4 text-[11px] leading-5 text-ink-faint">
        Every generation is screened against your brand rules and approved product facts. Anything that asserts a
        claim you have not verified is held for review rather than published.
      </p>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-ink text-canvas' : 'border border-line text-ink-soft hover:bg-canvas-alt'
      }`}
    >
      {children}
    </button>
  );
}
