import { useEffect, useMemo, useState } from 'react';
import { BillingNav } from '@/components/billing/BillingNav';
import { MonthlyRevenue } from '@/components/billing/MonthlyRevenue';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useCompanySettings } from '@/hooks/useBilling';
import {
  buildExportZip, downloadBlob, loadPeriod, monthPeriod, summarize, yearPeriod,
  buildCsv, type Period, type VatSummary,
} from '@/lib/exportBooks';
import { eur } from '@/types/billing';
import { Download, FileSpreadsheet, Loader2, Package, Calendar } from 'lucide-react';

const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export default function ExportPage() {
  const { settings } = useCompanySettings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | 'jahr'>(now.getMonth() + 1);
  const [sum, setSum] = useState<VatSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const period: Period = useMemo(
    () => (month === 'jahr' ? yearPeriod(year) : monthPeriod(year, month as number)),
    [year, month],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { docs, items, cash } = await loadPeriod(period);
      if (!cancelled) { setSum(summarize(docs, items, cash)); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [period]);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const exportZip = async () => {
    setBusy('zip'); setProgress({ done: 0, total: 0 });
    try {
      const blob = await buildExportZip(period, settings, (done, total) => setProgress({ done, total }));
      downloadBlob(blob, `Buchhaltung_${period.label}.zip`);
      toast.success('Export erstellt');
    } catch (e) {
      toast.error('Export fehlgeschlagen: ' + (e as Error).message);
    } finally { setBusy(null); setProgress(null); }
  };

  const exportCsv = async () => {
    setBusy('csv');
    try {
      const { docs, items } = await loadPeriod(period);
      downloadBlob(new Blob([buildCsv(docs, items)], { type: 'text/csv;charset=utf-8' }), `Rechnungsjournal_${period.label}.csv`);
      toast.success('Journal erstellt');
    } catch (e) { toast.error('Fehlgeschlagen: ' + (e as Error).message); } finally { setBusy(null); }
  };

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-1">Export für den Steuerberater</h1>
        <p className="text-sm text-muted-foreground mb-5">
          Monat oder Jahr wählen – du bekommst alle Rechnungs-PDFs, das Rechnungsjournal, das Kassabuch
          und eine Umsatzsteuer-Zusammenfassung in einer ZIP-Datei.
        </p>

        <div className="mb-4"><MonthlyRevenue compact /></div>

        <Card className="p-4 mb-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Calendar className="w-3 h-3" /> Jahr</Label>
              <div className="flex gap-1">
                {years.map((y) => (
                  <Button key={y} size="sm" variant={year === y ? 'secondary' : 'outline'} onClick={() => setYear(y)}>{y}</Button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <Label className="text-xs text-muted-foreground mb-1 block">Zeitraum</Label>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant={month === 'jahr' ? 'secondary' : 'outline'} onClick={() => setMonth('jahr')}>
                Ganzes Jahr
              </Button>
              {MONTHS.map((m, i) => (
                <Button key={m} size="sm" variant={month === i + 1 ? 'secondary' : 'outline'} onClick={() => setMonth(i + 1)}>
                  {m.slice(0, 3)}
                </Button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-4 mb-4">
          <h2 className="font-semibold mb-3">
            Umsatzsteuer {month === 'jahr' ? year : `${MONTHS[(month as number) - 1]} ${year}`}
          </h2>
          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Berechne …</p>
          ) : !sum || sum.count === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Belege in diesem Zeitraum.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div><div className="text-xs text-muted-foreground">Belege</div><div className="text-xl font-bold">{sum.count}</div></div>
                <div><div className="text-xs text-muted-foreground">Netto</div><div className="text-xl font-bold">{eur(sum.net)}</div></div>
                <div><div className="text-xs text-muted-foreground">USt (Zahllast)</div><div className="text-xl font-bold text-amber-700">{eur(sum.vat)}</div></div>
                <div><div className="text-xs text-muted-foreground">Brutto</div><div className="text-xl font-bold">{eur(sum.gross)}</div></div>
              </div>
              <div className="border rounded-lg overflow-hidden text-sm">
                <div className="grid grid-cols-3 bg-muted/60 px-3 py-1.5 text-xs font-semibold">
                  <span>Steuersatz</span><span className="text-right">Entgelte (netto)</span><span className="text-right">USt</span>
                </div>
                {sum.byRate.map((r) => (
                  <div key={r.rate} className="grid grid-cols-3 px-3 py-1.5 border-t">
                    <span>{r.rate} %</span>
                    <span className="text-right">{eur(r.net)}</span>
                    <span className="text-right">{eur(r.vat)}</span>
                  </div>
                ))}
              </div>
              {(sum.cashIn > 0 || sum.cashOut > 0) && (
                <p className="text-xs text-muted-foreground mt-2">
                  Kassabuch: Eingänge {eur(sum.cashIn)} · Ausgänge {eur(sum.cashOut)}
                </p>
              )}
              {sum.cancelledCount > 0 && (
                <p className="text-xs text-red-600 mt-2">
                  ⚠ {sum.cancelledCount} stornierte Belege über {eur(sum.cancelledSum)} sind im Zeitraum vorhanden und
                  wurden NICHT mitgerechnet (weder in den Summen noch im ZIP).
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Sollversteuerung nach Ausstellungsdatum · Gutschriften negativ gerechnet.
              </p>
            </>
          )}
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button className="gap-2" disabled={!!busy || !sum?.count} onClick={exportZip}>
            {busy === 'zip' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
            {busy === 'zip'
              ? `PDFs werden erzeugt … ${progress?.done ?? 0}/${progress?.total ?? 0}`
              : 'Komplett-Export als ZIP'}
          </Button>
          <Button variant="outline" className="gap-2" disabled={!!busy || !sum?.count} onClick={exportCsv}>
            {busy === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Nur Journal (CSV)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
          <Download className="w-3 h-3" /> Die ZIP enthält: alle Rechnungs-PDFs, Rechnungsjournal.csv, Kassabuch.csv und die UVA-Zusammenfassung.
        </p>
      </main>
    </div>
  );
}
