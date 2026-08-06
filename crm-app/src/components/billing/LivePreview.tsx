import { useEffect, useRef, useState } from 'react';
import type { BillingDocument, CompanySettings, DocumentItem } from '@/types/billing';
import { buildDocumentPdf, epcQr } from '@/lib/documentPdf';
import { Loader2 } from 'lucide-react';

/**
 * Live-A4-Vorschau: rendert das echte PDF, während getippt wird – also
 * schon BEVOR der Beleg gespeichert wird (entkoppelt per Debounce).
 */
export function LivePreview({
  doc, items, settings, className = '',
}: {
  doc: Partial<BillingDocument>;
  items: Partial<DocumentItem>[];
  settings: CompanySettings | null;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastUrl = useRef<string | null>(null);

  const signature = JSON.stringify({ doc, items: items.map((i) => ({ ...i, _k: undefined })) });

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const full = { ...doc, id: doc.id || 'preview' } as BillingDocument;
        const its = items.map((i, n) => ({ ...i, position: n } as DocumentItem));
        let qr: string | null = null;
        if (full.kind !== 'offer' && settings?.iban) {
          qr = await epcQr({
            name: settings.company_name || '', iban: settings.iban, bic: settings.bic || '',
            amount: Number(full.gross) || 0, reference: full.number || '',
          });
        }
        const pdf = buildDocumentPdf(full, its, settings, qr);
        const blobUrl = pdf.output('bloburl') as unknown as string;
        if (cancelled) return;
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = String(blobUrl);
        setUrl(String(blobUrl));
      } catch {
        /* Vorschau ist unkritisch */
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, settings]);

  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  return (
    <div className={`relative bg-muted/40 rounded-xl border overflow-hidden ${className}`}>
      {busy && (
        <div className="absolute top-2 right-2 z-10 bg-card/90 rounded-full p-1.5 shadow">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        </div>
      )}
      {url ? (
        <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title="Vorschau" className="w-full h-full" />
      ) : (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Vorschau wird erstellt …</div>
      )}
    </div>
  );
}
