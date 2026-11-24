/**
 * Werbeerfolg (ROAS) – was Facebook/Instagram-Anzeigen und Briefe gekostet und an Aufträgen gebracht haben (24.11.2026).
 * Rechnen: src/lib/werbeerfolg.ts. Doku: docs/17-werbeerfolg.md.
 *
 * Auftragswert (angenommene Angebote, Rechnungsketten – auch noch nicht verrechnet) und Verrechnetes kommen aus den Belegen,
 * die Herkunft je Firma aus der Anfrage im CRM oder von Hand (Auswahl in der Liste).
 * Kosten kommen aus dem Kontoauszug (Liquidität): FACEBK → Facebook/Instagram, PAGRO/POST → Briefe.
 * Einzelne Buchungen lassen sich ausnehmen, fehlende Kosten (z. B. vor 2026) von Hand nachtragen.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { AppNav } from '@/components/AppNav';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { eur } from '@/types/billing';
import { Target, Search, Trash2 } from 'lucide-react';
import {
  Beleg, Buchung, Firma, Herkunft, HERKUNFT, HerkunftZeile, KANAL_LABEL, Kunde, KostenKanal, KostenPosten, KostenZeile,
  LeadQuelle, firmenBilden, kanalSumme, kostenBilden, kostenKanalVon, monatsVerlauf, summeIm, imZeitraum,
} from '@/lib/werbeerfolg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** PostgREST liefert höchstens 1000 Zeilen am Stück – daher seitenweise holen. */
async function alle<T>(tabelle: string, spalten: string, ordnung: string, filter?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (let von = 0; ; von += 1000) {
    let q = db.from(tabelle).select(spalten).order(ordnung);
    if (ordnung !== 'id' && ordnung !== 'firma_key') q = q.order('id'); // feste Reihenfolge über die Seiten hinweg
    q = q.range(von, von + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

const MONATE = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const monatKurz = (k: string, mitJahr: boolean) => `${MONATE[Number(k.slice(5, 7)) - 1]}${mitJahr ? ' ' + k.slice(2, 4) : ''}`;
const euro0 = (n: number) => n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const faktor = (n: number | null) => (n == null ? '–' : `${n.toLocaleString('de-AT', { maximumFractionDigits: n < 10 ? 1 : 0 })}×`);
const datumKurz = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit' });

type Filter = 'alle' | 'werbung' | Herkunft | 'andere' | 'ohne';
type ChartKanal = 'werbung' | KostenKanal;
const KANAELE: Record<ChartKanal, KostenKanal[]> = { werbung: ['meta', 'brief'], meta: ['meta'], brief: ['brief'] };

export default function WerbeerfolgPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['werbeerfolg'],
    queryFn: async () => {
      const [belege, kunden, leads, herkunft, buchungen, kosten] = await Promise.all([
        alle<Beleg>('documents', 'id,kind,status,doc_date,net,customer_id,lead_id,recipient_company,recipient_name,projekt_id,project_total,source_document', 'doc_date',
          (q) => q.in('kind', ['invoice', 'partial_invoice', 'final_invoice', 'credit_note', 'offer'])),
        alle<Kunde>('customers', 'id,company_name,first_name,last_name,lead_id', 'id'),
        alle<LeadQuelle>('leads', 'id,source', 'id'),
        alle<HerkunftZeile>('werbe_herkunft', 'firma_key,firma,kanal', 'firma_key'),
        alle<Buchung>('liq_buchungen', 'id,konto,datum,betrag,text', 'datum', (q) => q.lt('betrag', 0)),
        alle<KostenZeile>('werbekosten', 'id,buchung_id,kanal,datum,betrag,text', 'erstellt_am'),
      ]);
      return { firmen: firmenBilden(belege, kunden, leads, herkunft), kosten: kostenBilden(buchungen, kosten) };
    },
  });
  const neuLaden = () => qc.invalidateQueries({ queryKey: ['werbeerfolg'] });

  const jahre = useMemo(() => {
    const s = new Set<string>();
    for (const f of data?.firmen ?? []) for (const p of [...f.auftraege, ...f.rechnungen]) s.add(p.datum.slice(0, 4));
    for (const p of data?.kosten ?? []) s.add(p.datum.slice(0, 4));
    return [...s].filter((j) => j >= '2025').sort().reverse();
  }, [data]);
  const [zeitraumWahl, setZeitraum] = useState<string | null>(null);
  const zeitraum = zeitraumWahl ?? String(new Date().getFullYear());

  const [chartKanal, setChartKanal] = useState<ChartKanal>('werbung');
  const [tabelle, setTabelle] = useState(false);
  const [filter, setFilter] = useState<Filter>('alle');
  const [suche, setSuche] = useState('');
  const [alleFirmen, setAlleFirmen] = useState(false);
  const [kostenOffen, setKostenOffen] = useState(false);

  const s = useMemo(() => {
    if (!data) return null;
    const { firmen, kosten } = data;
    return {
      gesamt: kanalSumme(firmen, kosten, ['meta', 'brief'], zeitraum),
      meta: kanalSumme(firmen, kosten, ['meta'], zeitraum),
      brief: kanalSumme(firmen, kosten, ['brief'], zeitraum),
      verlauf: monatsVerlauf(firmen, kosten, KANAELE[chartKanal], zeitraum),
      ohneHerkunft: firmen.filter((f) => !f.herkunft && (summeIm(f.auftraege, zeitraum) !== 0 || summeIm(f.rechnungen, zeitraum) !== 0)),
      andere: firmen.filter((f) => f.herkunft && !kostenKanalVon(f.herkunft)).reduce((n, f) => n + summeIm(f.auftraege, zeitraum), 0),
    };
  }, [data, zeitraum, chartKanal]);

  const liste = useMemo(() => {
    if (!data) return [];
    const q = suche.trim().toLowerCase();
    return data.firmen
      .map((f) => ({ f, auftrag: summeIm(f.auftraege, zeitraum), verrechnet: summeIm(f.rechnungen, zeitraum) }))
      .filter(({ auftrag, verrechnet }) => auftrag !== 0 || verrechnet !== 0)
      .filter(({ f }) => {
        if (q) return f.name.toLowerCase().includes(q);
        if (filter === 'alle') return true;
        if (filter === 'werbung') return Boolean(kostenKanalVon(f.herkunft));
        if (filter === 'andere') return Boolean(f.herkunft) && !kostenKanalVon(f.herkunft);
        if (filter === 'ohne') return !f.herkunft;
        return f.herkunft === filter;
      })
      .sort((a, b) => b.auftrag - a.auftrag || b.verrechnet - a.verrechnet);
  }, [data, zeitraum, filter, suche]);

  async function herkunftSetzen(f: Firma, wert: string) {
    const r = wert
      ? await db.from('werbe_herkunft').upsert({ firma_key: f.key, firma: f.name, kanal: wert, geaendert_am: new Date().toISOString() })
      : await db.from('werbe_herkunft').delete().eq('firma_key', f.key);
    if (r.error) { toast.error('Speichern fehlgeschlagen: ' + r.error.message); return; }
    toast.success(wert ? `${f.name}: ${HERKUNFT.find((h) => h.wert === wert)?.label}` : `${f.name}: Herkunft wieder laut Anfrage`);
    neuLaden();
  }

  async function buchungUmschalten(p: KostenPosten) {
    const r = p.kanal
      ? await db.from('werbekosten').upsert({ buchung_id: p.buchungId, kanal: null }, { onConflict: 'buchung_id' })
      : await db.from('werbekosten').delete().eq('buchung_id', p.buchungId);
    if (r.error) { toast.error('Speichern fehlgeschlagen: ' + r.error.message); return; }
    neuLaden();
  }

  async function eintragLoeschen(p: KostenPosten) {
    const r = await db.from('werbekosten').delete().eq('id', p.id);
    if (r.error) { toast.error('Löschen fehlgeschlagen: ' + r.error.message); return; }
    neuLaden();
  }

  const [neu, setNeu] = useState({ datum: '', kanal: 'meta' as KostenKanal, betrag: '', text: '' });
  async function eintragAnlegen() {
    const betrag = Number(neu.betrag.replace(',', '.'));
    if (!neu.datum || !(betrag > 0)) { toast.error('Bitte Datum und Betrag angeben.'); return; }
    const r = await db.from('werbekosten').insert({ datum: neu.datum, kanal: neu.kanal, betrag, text: neu.text.trim() || null });
    if (r.error) { toast.error('Speichern fehlgeschlagen: ' + r.error.message); return; }
    setNeu({ datum: '', kanal: neu.kanal, betrag: '', text: '' });
    toast.success('Kosten nachgetragen');
    neuLaden();
  }

  const kostenImZeitraum = (data?.kosten ?? []).filter((p) => imZeitraum(p.datum, zeitraum));
  const mitJahr = zeitraum === 'alle';
  const letzter = s?.verlauf.length ? s.verlauf.length - 1 : -1;

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Target className="w-6 h-6" /> Werbeerfolg</h1>
            <p className="text-sm text-muted-foreground">Was Anzeigen und Briefe gekostet und gebracht haben – Auftragswert (auch noch nicht verrechnet) und Verrechnetes netto aus Angeboten und Rechnungen, Kosten aus dem Kontoauszug.</p>
          </div>
          <div className="flex gap-1">
            {jahre.map((j) => <Button key={j} size="sm" variant={zeitraum === j ? 'secondary' : 'outline'} onClick={() => setZeitraum(j)}>{j}</Button>)}
            <Button size="sm" variant={zeitraum === 'alle' ? 'secondary' : 'outline'} onClick={() => setZeitraum('alle')}>Gesamt</Button>
          </div>
        </div>

        {error && <Card className="p-4 text-sm text-red-700">Laden fehlgeschlagen: {String((error as Error).message ?? error)}</Card>}
        {isLoading && <p className="text-muted-foreground">Wird geladen …</p>}

        {s && data && (
          <>
            {(['meta', 'brief'] as const).some((k) => s[k].auftrag > 0 && s[k].kosten === 0) && (
              <Card className="p-3 mb-3 text-sm bg-amber-50 border-amber-200 text-amber-900">
                Für {zeitraum === 'alle' ? 'einen Teil des Zeitraums' : zeitraum} fehlen Kosten
                ({(['meta', 'brief'] as const).filter((k) => s[k].auftrag > 0 && s[k].kosten === 0).map((k) => KANAL_LABEL[k]).join(', ')}) –
                der Kontoauszug im Cockpit beginnt mit Jänner 2026. Unten bei „Kosten“ nachtragen, dann stimmt der ROAS.
              </Card>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {([['Werbung gesamt', s.gesamt], [KANAL_LABEL.meta, s.meta], [KANAL_LABEL.brief, s.brief]] as const).map(([titel, k]) => (
                <Card key={titel} className="p-4">
                  <div className="text-sm font-semibold">{titel}</div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-3xl font-bold tabular-nums">{faktor(k.roas)}</span>
                    <span className="text-xs text-muted-foreground">ROAS</span>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {k.roas == null ? 'Keine Kosten im Zeitraum' : <>Aus 1 € wurden {k.roas.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })} Auftrag · nur Verrechnetes: {faktor(k.roasVerrechnet)}</>}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-sm tabular-nums">
                    <dt className="text-muted-foreground">Auftragswert</dt><dd className="text-right font-medium">{euro0(k.auftrag)}</dd>
                    <dt className="text-muted-foreground">davon verrechnet</dt><dd className="text-right font-medium">{euro0(k.verrechnet)}</dd>
                    <dt className="text-muted-foreground">Kosten</dt><dd className="text-right font-medium">{euro0(k.kosten)}</dd>
                    <dt className="text-muted-foreground">Neue Kunden</dt><dd className="text-right font-medium">{k.neukunden}</dd>
                    <dt className="text-muted-foreground">Kosten je Kunde</dt><dd className="text-right font-medium">{k.neukunden ? euro0(k.kosten / k.neukunden) : '–'}</dd>
                  </dl>
                  {titel === KANAL_LABEL.meta && k.auftragInstagram > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-1">Auftragswert davon Instagram {euro0(k.auftragInstagram)}</div>
                  )}
                </Card>
              ))}
            </div>

            <Card className="p-3 mb-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="text-sm font-semibold flex-1">Kosten und Aufträge, aufsummiert</div>
                {(Object.keys(KANAELE) as ChartKanal[]).map((k) => (
                  <Button key={k} size="sm" variant={chartKanal === k ? 'secondary' : 'ghost'} className="h-7 text-xs" onClick={() => setChartKanal(k)}>
                    {k === 'werbung' ? 'Alle Werbung' : KANAL_LABEL[k]}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setTabelle((v) => !v)}>{tabelle ? 'Als Linien' : 'Als Tabelle'}</Button>
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground mb-1" aria-hidden>
                <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 rounded" style={{ background: 'var(--viz-umsatz)' }} />Auftragswert</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--viz-umsatz)' }} />verrechnet</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 rounded" style={{ background: 'var(--viz-kosten)' }} />Kosten</span>
              </div>
              {s.verlauf.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Im Zeitraum weder Kosten noch Aufträge.</p>
              ) : tabelle ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm tabular-nums">
                    <thead><tr className="text-xs text-muted-foreground text-right"><th className="text-left font-normal py-1">Monat</th><th className="font-normal">Kosten</th><th className="font-normal">Auftragswert</th><th className="font-normal">verrechnet</th><th className="font-normal">Kosten bisher</th><th className="font-normal">Aufträge bisher</th><th className="font-normal">verrechnet bisher</th></tr></thead>
                    <tbody className="divide-y">
                      {s.verlauf.map((m) => (
                        <tr key={m.monat} className="text-right"><td className="text-left py-1">{monatKurz(m.monat, true)}</td><td>{euro0(m.kosten)}</td><td>{euro0(m.auftrag)}</td><td>{euro0(m.verrechnet)}</td><td>{euro0(m.kostenSumme)}</td><td>{euro0(m.auftragSumme)}</td><td>{euro0(m.verrechnetSumme)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={s.verlauf} margin={{ top: 8, right: 100, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="monat" tickFormatter={(k) => monatKurz(String(k), mitJahr)} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={12} />
                      <YAxis width={56} tickFormatter={(v) => kurzEuro(Number(v))} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
                        labelFormatter={(k) => monatKurz(String(k), true)}
                        formatter={(v, name, item) => {
                          const m = (item as { payload?: { kosten: number; auftrag: number; verrechnet: number } }).payload;
                          if (name === 'auftragSumme') return [`${euro0(Number(v))} (im Monat ${euro0(m?.auftrag ?? 0)})`, 'Aufträge bisher'];
                          if (name === 'verrechnetSumme') return [`${euro0(Number(v))} (im Monat ${euro0(m?.verrechnet ?? 0)})`, 'verrechnet bisher'];
                          return [`${euro0(Number(v))} (im Monat ${euro0(m?.kosten ?? 0)})`, 'Kosten bisher'];
                        }}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Line type="monotone" dataKey="auftragSumme" stroke="var(--viz-umsatz)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false}>
                        <LabelList dataKey="auftragSumme" content={(p) => endLabel(p, letzter, 'Aufträge')} />
                      </Line>
                      <Line type="monotone" dataKey="verrechnetSumme" stroke="var(--viz-umsatz)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                      <Line type="monotone" dataKey="kostenSumme" stroke="var(--viz-kosten)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false}>
                        <LabelList dataKey="kostenSumme" content={(p) => endLabel(p, letzter, 'Kosten')} />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="p-3 lg:col-span-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <div className="text-sm font-semibold flex-1">Kunden und woher sie kamen</div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
                    <Input className="h-8 w-44 pl-7 text-sm" placeholder="Firma suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {([['alle', 'Alle'], ['werbung', 'Werbung'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['brief', 'Brief'], ['andere', 'Andere'], ['ohne', `Ohne Herkunft (${s.ohneHerkunft.length})`]] as [Filter, string][]).map(([w, l]) => (
                    <Button key={w} size="sm" variant={filter === w && !suche ? 'secondary' : 'ghost'} className="h-7 text-xs" onClick={() => { setFilter(w); setSuche(''); setAlleFirmen(false); }}>{l}</Button>
                  ))}
                </div>
                {filter === 'ohne' && !suche && (
                  <p className="text-xs text-muted-foreground mb-2">Hier fehlt die Herkunft. Wähl sie aus – dann zählt der Auftrag beim richtigen Kanal.</p>
                )}
                <div className="divide-y">
                  {(alleFirmen ? liste : liste.slice(0, 40)).map(({ f, auftrag, verrechnet }) => (
                    <div key={f.key} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <div className="flex-1 min-w-[180px]">
                        <div className="text-sm font-medium">{f.name}</div>
                        <div className="text-[11px] text-muted-foreground">Kunde seit {datumKurz(f.erste)}{f.herkunft && !f.vonHand ? ' · Herkunft laut Anfrage' : ''}</div>
                      </div>
                      <select className="h-8 rounded-md border bg-background px-1.5 text-xs" value={f.herkunft ?? ''} onChange={(e) => herkunftSetzen(f, e.target.value)} aria-label={`Herkunft ${f.name}`}>
                        <option value="">Herkunft unbekannt</option>
                        {HERKUNFT.map((h) => <option key={h.wert} value={h.wert}>{h.label}</option>)}
                      </select>
                      <div className="w-28 ml-auto text-right tabular-nums">
                        <div className="text-sm font-medium">{euro0(auftrag)}</div>
                        <div className="text-[11px] text-muted-foreground">{Math.abs(verrechnet - auftrag) < 0.5 ? 'ganz verrechnet' : `verrechnet ${euro0(verrechnet)}`}</div>
                      </div>
                    </div>
                  ))}
                  {liste.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Keine Kunden mit Aufträgen im Zeitraum.</p>}
                </div>
                {!alleFirmen && liste.length > 40 && (
                  <Button size="sm" variant="ghost" className="mt-1 text-xs" onClick={() => setAlleFirmen(true)}>Alle {liste.length} zeigen</Button>
                )}
              </Card>

              <Card className="p-3 self-start min-w-0">
                <div className="text-sm font-semibold mb-1">Kosten {zeitraum === 'alle' ? '' : zeitraum}</div>
                <dl className="grid grid-cols-2 gap-y-0.5 text-sm tabular-nums mb-2">
                  <dt className="text-muted-foreground">{KANAL_LABEL.meta}</dt><dd className="text-right">{euro0(s.meta.kosten)}</dd>
                  <dt className="text-muted-foreground">{KANAL_LABEL.brief}</dt><dd className="text-right">{euro0(s.brief.kosten)}</dd>
                </dl>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Aus dem Kontoauszug: FACEBK → Facebook & Instagram, PAGRO und POST → Briefe (erst ab Juni 2026, davor ausgenommen).
                  {s.andere !== 0 && ` Aufträge über andere Wege (privat, Empfehlung, YouTube, Website …): ${euro0(s.andere)}.`}
                </p>
                <Button size="sm" variant="outline" className="w-full mb-2 text-xs" onClick={() => setKostenOffen((v) => !v)}>
                  {kostenOffen ? 'Buchungen ausblenden' : `Buchungen zeigen (${kostenImZeitraum.length})`}
                </Button>
                {kostenOffen && (
                  <>
                    <div className="space-y-1 mb-3">
                      {kostenImZeitraum.map((p) => (
                        <div key={p.id} className={'text-xs flex items-start gap-2' + (p.kanal ? '' : ' opacity-50')}>
                          <div className="flex-1 min-w-0">
                            <div className="tabular-nums text-muted-foreground">{datumKurz(p.datum)} · {p.kanal ? KANAL_LABEL[p.kanal] : 'zählt nicht'}{p.eigenerEintrag ? ' · nachgetragen' : ''}</div>
                            <div className="truncate" title={p.text}>{p.text || '–'}</div>
                          </div>
                          <div className="tabular-nums font-medium pt-3.5">{eur(p.betrag)}</div>
                          {p.eigenerEintrag ? (
                            <button type="button" className="pt-3.5 text-muted-foreground hover:text-red-600" onClick={() => eintragLoeschen(p)} aria-label="Eintrag löschen"><Trash2 className="w-3.5 h-3.5" /></button>
                          ) : (
                            <button type="button" className="pt-3 text-[11px] underline text-muted-foreground hover:text-foreground" onClick={() => buchungUmschalten(p)}>
                              {p.kanal ? 'ausnehmen' : 'mitzählen'}
                            </button>
                          )}
                        </div>
                      ))}
                      {kostenImZeitraum.length === 0 && <p className="text-xs text-muted-foreground">Keine Buchungen im Zeitraum.</p>}
                    </div>
                    <div className="border-t pt-2 space-y-1.5">
                      <div className="text-xs font-semibold">Kosten nachtragen</div>
                      <div className="flex gap-1.5">
                        <Input type="date" className="h-8 text-xs" value={neu.datum} onChange={(e) => setNeu({ ...neu, datum: e.target.value })} />
                        <select className="h-8 rounded-md border bg-background px-1.5 text-xs" value={neu.kanal} onChange={(e) => setNeu({ ...neu, kanal: e.target.value as KostenKanal })}>
                          <option value="meta">{KANAL_LABEL.meta}</option>
                          <option value="brief">{KANAL_LABEL.brief}</option>
                        </select>
                      </div>
                      <div className="flex gap-1.5">
                        <Input className="h-8 text-xs w-24" inputMode="decimal" placeholder="Betrag €" value={neu.betrag} onChange={(e) => setNeu({ ...neu, betrag: e.target.value })} />
                        <Input className="h-8 text-xs" placeholder="Wofür (z. B. Druckerei)" value={neu.text} onChange={(e) => setNeu({ ...neu, text: e.target.value })} />
                      </div>
                      <Button size="sm" className="w-full h-8 text-xs" onClick={eintragAnlegen}>Speichern</Button>
                    </div>
                  </>
                )}
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** Wert direkt ans Linienende schreiben (nur beim letzten Punkt). */
function endLabel(p: { x?: number | string; y?: number | string; value?: number | string; index?: number }, letzter: number, name: string) {
  if (p.index !== letzter || p.x == null || p.y == null) return null;
  return (
    <text x={Number(p.x) + 6} y={Number(p.y)} dy={4} fontSize={11} fill="hsl(var(--foreground))">
      {name} {kurzEuro(Number(p.value))}
    </text>
  );
}

/** 12.400 → „12,4 T€“, 850 → „850 €“ (Achse und Linienende). */
function kurzEuro(v: number) {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('de-AT', { maximumFractionDigits: 1 })} T€` : `${Math.round(v)} €`;
}
