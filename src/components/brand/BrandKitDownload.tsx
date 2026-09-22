'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * The brand-kit download.
 *
 * Fetched rather than a plain link, so a failure renders as a message instead
 * of navigating the browser to a JSON error page — which for a download link
 * is a particularly bad failure, because the user loses the page they were on
 * and gets raw JSON in exchange.
 */
export function BrandKitDownload({ brandId }: { brandId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/export/brand-kit?brandId=${encodeURIComponent(brandId)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Could not build the kit.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      // The filename the server chose is in Content-Disposition, but a blob
      // URL does not carry it — so it is set again here rather than letting
      // the browser name the file after a uuid.
      anchor.download =
        response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'brand-kit.zip';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the kit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="subtle"
        loading={busy}
        onClick={() => void download()}
        icon={<Download className="h-3.5 w-3.5" />}
      >
        Download kit
      </Button>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
