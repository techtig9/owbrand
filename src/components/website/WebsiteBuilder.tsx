'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Monitor,
  Tablet,
  Smartphone,
  Eye,
  Save,
  ChevronUp,
  ChevronDown,
  EyeOff,
  Loader2,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { SectionRenderer } from '@/components/website/SectionRenderer';
import type { SectionContent } from '@/lib/website/schema';

/**
 * The website editor.
 *
 * Three panels, per the frontend spec: LEFT pages/sections, CENTER a responsive
 * canvas, RIGHT the properties for whatever is selected. TOP carries the
 * breakpoint switcher, preview toggle and save state.
 *
 * This replaces a `<pre>{JSON.stringify(site)}</pre>`. It is deliberately
 * restrained on styling — Phase 5 replaces the design system wholesale, so
 * polish invested here would be discarded. What it does provide is the real
 * structure and real editing against the persisted site.
 */

interface StoredSection {
  id: string;
  kind: string;
  sortOrder: number;
  content: SectionContent;
  styles: Record<string, unknown>;
  visible: boolean;
}

interface StoredPage {
  id: string;
  slug: string;
  title: string;
  isHome: boolean;
  seo: Record<string, unknown>;
  status: string;
  sortOrder: number;
  sections: StoredSection[];
}

type Breakpoint = 'desktop' | 'tablet' | 'mobile';

const BREAKPOINT_WIDTH: Record<Breakpoint, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
};

export function WebsiteBuilder({ brandId }: { brandId: string }) {
  const [pages, setPages] = useState<StoredPage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop');
  const [previewMode, setPreviewMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/website?brandId=${encodeURIComponent(brandId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not load the site.');

      setPages(data.pages ?? []);
      setActivePageId((current) => current ?? data.pages?.[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the site.');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) ?? pages[0] ?? null,
    [pages, activePageId]
  );

  const selectedSection = useMemo(
    () => activePage?.sections.find((section) => section.id === selectedSectionId) ?? null,
    [activePage, selectedSectionId]
  );

  /** Applies an edit locally so the canvas updates immediately. */
  function patchSectionLocally(sectionId: string, patch: Partial<StoredSection>) {
    setPages((current) =>
      current.map((page) => ({
        ...page,
        sections: page.sections.map((section) =>
          section.id === sectionId ? { ...section, ...patch } : section
        ),
      }))
    );
    setDirty(true);
  }

  async function persistSection(section: StoredSection) {
    setSaving(true);
    try {
      const response = await fetch('/api/website/sections', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId,
          sectionId: section.id,
          content: section.content,
          styles: section.styles,
          visible: section.visible,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save.');

      setDirty(false);
      toast.success('Saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function moveSection(sectionId: string, direction: -1 | 1) {
    if (!activePage) return;

    const ordered = [...activePage.sections].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((s) => s.id === sectionId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ordered.length) return;

    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const reordered = ordered.map((section, i) => ({ ...section, sortOrder: i }));

    setPages((current) =>
      current.map((page) => (page.id === activePage.id ? { ...page, sections: reordered } : page))
    );

    setSaving(true);
    try {
      const response = await fetch('/api/website/sections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandId,
          pageId: activePage.id,
          orderedSectionIds: reordered.map((s) => s.id),
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? 'Could not reorder.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder.');
      // The optimistic move is wrong now, so re-read the truth.
      void load();
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------------------------------------------- *
   * States
   * ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[240px_1fr_300px]" role="status" aria-label="Loading the editor">
        <div className="h-[70vh] animate-pulse rounded-2xl bg-canvas-alt" />
        <div className="h-[70vh] animate-pulse rounded-2xl bg-canvas-alt" />
        <div className="h-[70vh] animate-pulse rounded-2xl bg-canvas-alt" />
        <span className="sr-only">Loading the editor…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          Could not load the site
        </div>
        <p className="mt-2 text-sm text-red-700">{error}</p>
        <button type="button" onClick={() => void load()} className="btn-ghost mt-4">
          Try again
        </button>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white px-6 py-20 text-center">
        <span className="rounded-2xl bg-canvas-alt p-3">
          <FileText className="h-6 w-6 text-ink-faint" aria-hidden="true" />
        </span>
        <h3 className="mt-4 font-display text-lg font-semibold text-ink">No website yet</h3>
        <p className="mt-2 max-w-sm text-sm text-ink-soft">
          Generate a site from your Brand Brain and it will appear here, fully editable.
        </p>
      </div>
    );
  }

  const orderedSections = activePage ? [...activePage.sections].sort((a, b) => a.sortOrder - b.sortOrder) : [];

  /* ---------------------------------------------------------------- *
   * Preview mode — canvas only
   * ---------------------------------------------------------------- */

  if (previewMode) {
    return (
      <div className="space-y-4">
        <Toolbar
          breakpoint={breakpoint}
          onBreakpoint={setBreakpoint}
          previewMode={previewMode}
          onPreviewMode={setPreviewMode}
          saving={saving}
          dirty={dirty}
          onSave={selectedSection ? () => void persistSection(selectedSection) : undefined}
        />
        <Canvas breakpoint={breakpoint} sections={orderedSections} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toolbar
        breakpoint={breakpoint}
        onBreakpoint={setBreakpoint}
        previewMode={previewMode}
        onPreviewMode={setPreviewMode}
        saving={saving}
        dirty={dirty}
        onSave={selectedSection ? () => void persistSection(selectedSection) : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr_300px]">
        {/* LEFT — pages and sections */}
        <aside className="rounded-2xl border border-line bg-white p-4">
          <p className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-faint">Pages</p>
          <nav className="mt-2 space-y-1">
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => {
                  setActivePageId(page.id);
                  setSelectedSectionId(null);
                }}
                aria-current={page.id === activePage?.id ? 'true' : undefined}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${
                  page.id === activePage?.id ? 'bg-ink text-canvas' : 'text-ink-soft hover:bg-canvas-alt'
                }`}
              >
                <span className="truncate">{page.title}</span>
                {page.isHome && <span className="ml-2 text-[10px] uppercase opacity-70">home</span>}
              </button>
            ))}
          </nav>

          <p className="mt-6 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-faint">Sections</p>
          <ol className="mt-2 space-y-1">
            {orderedSections.map((section, index) => (
              <li key={section.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedSectionId(section.id)}
                  aria-current={section.id === selectedSectionId ? 'true' : undefined}
                  className={`flex-1 truncate rounded-lg px-2.5 py-2 text-left text-xs capitalize ${
                    section.id === selectedSectionId
                      ? 'bg-canvas-alt font-semibold text-ink'
                      : 'text-ink-soft hover:bg-canvas-alt'
                  } ${section.visible ? '' : 'opacity-50'}`}
                >
                  {section.kind}
                </button>
                <button
                  type="button"
                  onClick={() => void moveSection(section.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${section.kind} up`}
                  className="rounded p-1 text-ink-faint hover:bg-canvas-alt disabled:opacity-30"
                >
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void moveSection(section.id, 1)}
                  disabled={index === orderedSections.length - 1}
                  aria-label={`Move ${section.kind} down`}
                  className="rounded p-1 text-ink-faint hover:bg-canvas-alt disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </aside>

        {/* CENTER — responsive canvas */}
        <Canvas
          breakpoint={breakpoint}
          sections={orderedSections}
          selectedSectionId={selectedSectionId}
          onSelect={setSelectedSectionId}
        />

        {/* RIGHT — properties */}
        <aside className="rounded-2xl border border-line bg-white p-4">
          {selectedSection ? (
            <PropertiesPanel
              section={selectedSection}
              onChange={(patch) => patchSectionLocally(selectedSection.id, patch)}
              onSave={() => void persistSection(selectedSection)}
              saving={saving}
            />
          ) : (
            <p className="text-sm text-ink-soft">Select a section to edit its content.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ */

function Toolbar(props: {
  breakpoint: Breakpoint;
  onBreakpoint: (value: Breakpoint) => void;
  previewMode: boolean;
  onPreviewMode: (value: boolean) => void;
  saving: boolean;
  dirty: boolean;
  onSave?: () => void;
}) {
  const breakpoints: Array<[Breakpoint, typeof Monitor, string]> = [
    ['desktop', Monitor, 'Desktop'],
    ['tablet', Tablet, 'Tablet'],
    ['mobile', Smartphone, 'Mobile'],
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3">
      <div className="flex items-center gap-1" role="group" aria-label="Preview width">
        {breakpoints.map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => props.onBreakpoint(value)}
            aria-pressed={props.breakpoint === value}
            aria-label={label}
            className={`rounded-lg p-2 ${
              props.breakpoint === value ? 'bg-ink text-canvas' : 'text-ink-soft hover:bg-canvas-alt'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {/* Honest save state rather than a permanently-enabled button. */}
        <span aria-live="polite" className="text-xs text-ink-faint">
          {props.saving ? 'Saving…' : props.dirty ? 'Unsaved changes' : 'All changes saved'}
        </span>

        <button
          type="button"
          onClick={() => props.onPreviewMode(!props.previewMode)}
          className="btn-ghost !px-4 !py-2 text-xs"
        >
          {props.previewMode ? (
            <>
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Exit preview
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
            </>
          )}
        </button>

        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.onSave || props.saving || !props.dirty}
          className="btn-primary !px-4 !py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {props.saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Save
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Canvas
 * ------------------------------------------------------------------ */

function Canvas(props: {
  breakpoint: Breakpoint;
  sections: StoredSection[];
  selectedSectionId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-canvas-alt p-4">
      <div
        className="mx-auto bg-white transition-[max-width] duration-200"
        style={{ maxWidth: BREAKPOINT_WIDTH[props.breakpoint] }}
      >
        {props.sections
          .filter((section) => section.visible)
          .map((section) =>
            props.onSelect ? (
              <div
                key={section.id}
                onClick={() => props.onSelect?.(section.id)}
                className={`cursor-pointer border-2 transition-colors ${
                  section.id === props.selectedSectionId
                    ? 'border-coral-400'
                    : 'border-transparent hover:border-line'
                }`}
              >
                <SectionRenderer content={section.content} />
              </div>
            ) : (
              <SectionRenderer key={section.id} content={section.content} />
            )
          )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Properties
 * ------------------------------------------------------------------ */

/**
 * Edits the text fields of whichever section is selected.
 *
 * Only string fields are exposed for now: they are where nearly all editing
 * happens, and a generic editor for nested arrays would be a worse experience
 * than the per-section forms Phase 5 will build.
 */
function PropertiesPanel(props: {
  section: StoredSection;
  onChange: (patch: Partial<StoredSection>) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { section } = props;
  const content = section.content as unknown as Record<string, unknown>;

  const textFields = Object.entries(content).filter(
    ([key, value]) => key !== 'kind' && typeof value === 'string'
  ) as Array<[string, string]>;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-faint">Section</p>
        <h3 className="mt-1 font-display text-base font-semibold capitalize text-ink">{section.kind}</h3>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={section.visible}
          onChange={(event) => props.onChange({ visible: event.target.checked })}
          className="h-4 w-4 rounded border-line"
        />
        Visible on the page
      </label>

      {textFields.length === 0 ? (
        <p className="text-xs text-ink-faint">
          This section has no simple text fields. Structured content editing arrives with the redesign.
        </p>
      ) : (
        <div className="space-y-3">
          {textFields.map(([key, value]) => {
            const id = `section-${section.id}-${key}`;
            const multiline = value.length > 80 || key === 'body';

            return (
              <div key={key}>
                <label htmlFor={id} className="mb-1 block text-xs font-medium capitalize text-ink-soft">
                  {key.replace(/([A-Z])/g, ' $1')}
                </label>
                {multiline ? (
                  <textarea
                    id={id}
                    value={value}
                    rows={4}
                    onChange={(event) =>
                      props.onChange({
                        content: { ...content, [key]: event.target.value } as unknown as SectionContent,
                      })
                    }
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                  />
                ) : (
                  <input
                    id={id}
                    value={value}
                    onChange={(event) =>
                      props.onChange({
                        content: { ...content, [key]: event.target.value } as unknown as SectionContent,
                      })
                    }
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={props.onSave}
        disabled={props.saving}
        className="btn-primary w-full !py-2 text-xs disabled:opacity-60"
      >
        {props.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        Save section
      </button>
    </div>
  );
}
