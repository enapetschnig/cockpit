import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { eur } from '@/types/billing';
import { TrendingUp, Loader2 } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const MONTHS = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

interface Row { doc_date: string; net: number; vat: number; gross: number; status: string; kind: string }

/**
 * Monatsumsatz über ALLE Rechnungen – auch die aus dem alten Programm.
 * Stornierte Belege zählen nicht mit, werden aber transparent ausgewiesen.
 */
export function MonthlyRevenue({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    (async () => {
      const { data } = await db.from('documents')
        .select('doc_date,net,vat,gross,status,kind')
        .in('kind', ['invoice', 'partial_invoice', 'final_invoice', 'credit_note'])
        .order('doc_date', { ascending: true }).limit(3000);
      setRows((data as Row[]) || []);
      setLoading(false);
    })();
  }, []);

  const years = useMemo(
    () => [...new Set(rows.map((r) => r.doc_date?.slice(0, 4)).filter(Boolean))].sort().reverse(),
    [rows],
  );

  const data = useMemo(() => {
    const y = String(year);
    const months = Array.from({ length: 12 }, () => ({ net: 0, vat: 0, gross: 0, count: 0, storno: 0, stornoSum: 0 }));
    for (const r of rows) {
      if (!r.doc_date?.startsWith(y)) continue;
      const m = Number(r.doc_date.slice(5, 7)) - 1;
      if (m < 0 || m > 11) continue;
      if (r.status === 'cancelled') { months[m].storno++; months[m].stornoSum += Number(r.gross || 0); continue; }
      const sign = r.kind === 'credit_note' ? -1 : 1;
      months[m].net += sign * Number(r.net || 0);
      months[m].vat += sign * Number(r.vat || 0);
      months[m].gross += sign * Number(r.gross || 0);
      months[m].count++;
    }
    const total = months.reduce((a, m) => ({
      net: a.net + m.net, vat: a.vat + m.vat, gross: a.gross + m.gross,
      count: a.count + m.count, storno: a.storno + m.storno, stornoSum: a.stornoSum + m.stornoSum,
    }), { net: 0, vat: 0, gross: 0, count: 0, storno: 0, stornoSum: 0 });
    const max = Math.max(1, ...months.map((m) => m.gross));
    return { months, total, max };
  }, [rows, year]);

  if (loading) return (
    <Card className="p-4"><p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Umsätze werden geladen …</p></Card>
  );

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Umsatz pro Monat</h2>
        <div className="flex gap-1">
          {years.slice(0, 5).map((y) => (
            <Button key={y} size="sm" variant={String(year) === y ? 'secondary' : 'outline'} onClick={() => setYear(Number(y))}>{y}</Button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {data.months.map((m, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-8 text-muted-foreground text-xs">{MONTHS[i]}</span>
            <div className="flex-1 h-5 bg-muted/50 rounded overflow-hidden relative">
              <div className="h-full bg-primary/70 rounded" style={{ width: `${Math.max(0, (m.gross / data.max) * 100)}%` }} />
              {m.count > 0 && (
                <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-foreground/70">
                  {m.count} {m.count === 1 ? 'Beleg' : 'Belege'}
                  {m.storno > 0 && <span className="ml-1 text-red-600">· {m.storno} storniert</span>}
                </span>
              )}
            </div>
            <span className="w-24 text-right font-medium">{m.gross ? eur(m.gross) : '—'}</span>
            {!compact && <span className="w-24 text-right text-xs text-muted-foreground">{m.net ? `netto ${eur(m.net)}` : ''}</span>}
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span><span className="text-muted-foreground">Jahr {year}:</span> <b>{eur(data.total.gross)}</b> brutto</span>
        <span className="text-muted-foreground">netto {eur(data.total.net)} · USt {eur(data.total.vat)}</span>
        <span className="text-muted-foreground">{data.total.count} Belege</span>
        {data.total.storno > 0 && (
          <span className="text-red-600">{data.total.storno} storniert ({eur(data.total.stornoSum)}) – nicht gerechnet</span>
        )}
      </div>
    </Card>
  );
}
