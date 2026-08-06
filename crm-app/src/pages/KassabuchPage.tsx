import { useMemo, useState } from 'react';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useCashBook } from '@/hooks/useBilling';
import { eur, fmtDate } from '@/types/billing';
import { Plus, ArrowDownCircle, ArrowUpCircle, Trash2 } from 'lucide-react';

export default function KassabuchPage() {
  const { entries, isLoading, add, remove } = useCashBook();
  const [form, setForm] = useState({ entry_date: new Date().toISOString().slice(0, 10), direction: 'in' as 'in' | 'out', gross: '', description: '', receipt_no: '', vat_rate: '20' });
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));

  const years = useMemo(() => [...new Set(entries.map((e) => e.entry_date?.slice(0, 4)).filter(Boolean))].sort().reverse(), [entries]);
  const list = useMemo(() => entries.filter((e) => !year || e.entry_date?.startsWith(year)), [entries, year]);
  // Aktueller Kassenstand über ALLE Einträge (stornierte zählen nicht)
  const kassenstand = useMemo(
    () => entries.filter((e) => !e.cancelled)
      .reduce((a, e) => a + (e.direction === 'in' ? 1 : -1) * Number(e.gross || 0), 0),
    [entries],
  );
  // Saldovortrag = Stand vor dem gefilterten Zeitraum
  const sums = useMemo(() => {
    const act = list.filter((e) => !e.cancelled);
    const inS = act.filter((e) => e.direction === 'in').reduce((a, e) => a + Number(e.gross || 0), 0);
    const outS = act.filter((e) => e.direction === 'out').reduce((a, e) => a + Number(e.gross || 0), 0);
    const first = list.length ? list[list.length - 1].entry_date : null;
    const vortrag = first
      ? entries.filter((e) => !e.cancelled && e.entry_date < first)
          .reduce((a, e) => a + (e.direction === 'in' ? 1 : -1) * Number(e.gross || 0), 0)
      : 0;
    return { inS, outS, saldo: inS - outS, vortrag, storniert: list.length - act.length };
  }, [list, entries]);

  // Laufender Saldo je Zeile (Liste ist absteigend sortiert)
  const runningById = useMemo(() => {
    const map: Record<string, number> = {};
    let bal = sums.vortrag;
    for (const e of [...list].reverse()) {
      if (!e.cancelled) bal += (e.direction === 'in' ? 1 : -1) * Number(e.gross || 0);
      map[e.id] = bal;
    }
    return map;
  }, [list, sums.vortrag]);

  const submit = async () => {
    const g = Number(String(form.gross).replace(',', '.'));
    if (!g) return;
    const rate = Number(form.vat_rate) || 0;
    const net = rate ? Math.round((g / (1 + rate / 100)) * 100) / 100 : g;
    await add({ entry_date: form.entry_date, direction: form.direction, gross: g, net, vat: Math.round((g - net) * 100) / 100, vat_rate: rate, description: form.description || null, receipt_no: form.receipt_no || null, payment_method: 'Bar' });
    setForm({ ...form, gross: '', description: '', receipt_no: '' });
  };

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold mb-1">Kassabuch</h1>
            <p className="text-sm text-muted-foreground">
              {list.length} Einträge{sums.storniert > 0 ? ` (${sums.storniert} storniert, nicht gerechnet)` : ''} ·
              Eingänge {eur(sums.inS)} · Ausgänge {eur(sums.outS)}
            </p>
          </div>
          <Card className="px-4 py-3 bg-primary/5 border-primary/30">
            <div className="text-xs text-muted-foreground">Aktueller Kassenstand</div>
            <div className="text-2xl font-bold">{eur(kassenstand)}</div>
            {sums.vortrag !== 0 && (
              <div className="text-[11px] text-muted-foreground">Saldovortrag Zeitraum: {eur(sums.vortrag)}</div>
            )}
          </Card>
        </div>

        <Card className="p-4 mb-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div><Label className="text-xs text-muted-foreground">Datum</Label><Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></div>
            <div><Label className="text-xs text-muted-foreground">Art</Label>
              <div className="flex gap-1">
                <Button size="sm" variant={form.direction === 'in' ? 'secondary' : 'outline'} onClick={() => setForm({ ...form, direction: 'in' })}>Eingang</Button>
                <Button size="sm" variant={form.direction === 'out' ? 'secondary' : 'outline'} onClick={() => setForm({ ...form, direction: 'out' })}>Ausgang</Button>
              </div>
            </div>
            <div className="w-28"><Label className="text-xs text-muted-foreground">Brutto €</Label><Input value={form.gross} onChange={(e) => setForm({ ...form, gross: e.target.value })} placeholder="0,00" /></div>
            <div className="w-20"><Label className="text-xs text-muted-foreground">USt %</Label><Input value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: e.target.value })} /></div>
            <div className="flex-1 min-w-[160px]"><Label className="text-xs text-muted-foreground">Beschreibung</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="w-28"><Label className="text-xs text-muted-foreground">Beleg-Nr.</Label><Input value={form.receipt_no} onChange={(e) => setForm({ ...form, receipt_no: e.target.value })} /></div>
            <Button onClick={submit} className="gap-1"><Plus className="w-4 h-4" /> Eintragen</Button>
          </div>
        </Card>

        <div className="flex gap-1 mb-3 flex-wrap">
          {years.map((y) => <Button key={y} size="sm" variant={year === y ? 'secondary' : 'outline'} onClick={() => setYear(y!)}>{y}</Button>)}
          <Button size="sm" variant={!year ? 'secondary' : 'outline'} onClick={() => setYear('')}>Alle</Button>
        </div>

        {isLoading ? <p className="text-muted-foreground">Laden …</p> : (
          <div className="space-y-1.5">
            {list.map((e) => (
              <Card key={e.id} className={`p-3 flex items-center gap-3 ${e.cancelled ? 'opacity-50' : ''}`}>
                {e.direction === 'in' ? <ArrowDownCircle className="w-5 h-5 text-emerald-600 shrink-0" /> : <ArrowUpCircle className="w-5 h-5 text-red-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{e.description || (e.receipt_no ? `Beleg ${e.receipt_no}` : '—')}</div>
                  <div className="text-xs text-muted-foreground">{fmtDate(e.entry_date)}{e.receipt_no ? ` · Beleg ${e.receipt_no}` : ''}{e.payment_method ? ` · ${e.payment_method}` : ''}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-semibold ${e.direction === 'in' ? 'text-emerald-700' : 'text-red-600'}`}>
                    {e.direction === 'in' ? '+' : '–'} {eur(Number(e.gross))}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {e.cancelled ? 'storniert' : `Stand ${eur(runningById[e.id] ?? 0)}`}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(e.id)}><Trash2 className="w-4 h-4" /></Button>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
