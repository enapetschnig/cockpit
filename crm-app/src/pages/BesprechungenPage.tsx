/**
 * „Besprechungen": alle Plaud-Aufnahmen, die der PC ins CRM geholt hat – oben die,
 * die noch zugeordnet werden müssen. Beim Kunden/Lead erscheinen sie zusätzlich.
 */
import { useMemo, useState } from 'react';
import { BillingNav } from '@/components/billing/BillingNav';
import { BesprechungKarte, useBesprechungen } from '@/components/Besprechungen';
import { Loader2 } from 'lucide-react';

export default function BesprechungenPage() {
  const { liste, laedt, laden } = useBesprechungen({ alle: true });
  const [privat, setPrivat] = useState(false);
  const sichtbar = useMemo(() => {
    const l = liste.filter((b) => privat || b.status !== 'ignoriert');
    return [...l.filter((b) => b.status === 'unklar'), ...l.filter((b) => b.status !== 'unklar')];
  }, [liste, privat]);

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Besprechungen</h1>
            <p className="text-sm text-muted-foreground">Aus Plaud – automatisch dem Kunden zugeordnet.</p>
          </div>
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <input type="checkbox" checked={privat} onChange={(e) => setPrivat(e.target.checked)} /> Private zeigen
          </label>
        </div>
        {laedt ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> :
          !sichtbar.length ? <p className="text-sm text-muted-foreground">Noch keine Besprechungen.</p> :
          sichtbar.map((b) => <BesprechungKarte key={b.id} b={b} mitWer neuLaden={laden} />)}
      </main>
    </div>
  );
}
