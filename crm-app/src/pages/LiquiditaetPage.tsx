import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { eur, fmtDate } from '@/types/billing';
import {
  berechneVorschau, dateiText, iso, kreditkarteNachHaendler, monatDazu, parseAuszugZeilen, parseCsv, pdfZeilen,
  schluesselVergeben, type Ereignis, type LiqAuszug, type LiqBuchung, type LiqPosten, type LiqSteuer, type Muster,
  type RechnungLite, type AngebotLite, type WartungLite, type VertragLite, type VolumenLite,
} from '@/lib/liquiditaet';
import { Upload, Loader2, EyeOff, Eye, Trash2, Plus, Landmark, Info } from 'lucide-react';

const db = supabase as any;
const MONATE = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const monatName = (m: string) => `${MONATE[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const GRUPPEN: Record<string, { label: string; farbe: string }> = {
  einnahme: { label: 'Eingang', farbe: 'bg-emerald-500' },
  fix: { label: 'Fixkosten', farbe: 'bg-slate-500' },
  finanzamt: { label: 'Finanzamt', farbe: 'bg-amber-500' },
  steuerberater: { label: 'Steuerberater', farbe: 'bg-violet-500' },
  variabel: { label: 'Laufend', farbe: 'bg-slate-300' },
  privat: { label: 'Privat', farbe: 'bg-sky-500' },
};
const INTERVALLE: [number, string][] = [[0, 'einmalig'], [1, 'monatlich'], [3, 'vierteljährlich'], [4, 'alle 4 Monate'], [6, 'halbjährlich'], [12, 'jährlich']];
const intervallText = (n: number) => INTERVALLE.find(([k]) => k === n)?.[1] || `alle ${n} Monate`;
const kurz = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

function Zeile({ e }: { e: Ereignis }) {
  const g = GRUPPEN[e.gruppe] || GRUPPEN.fix;
  return (
    <div className="flex items-center gap-3 py-1.5 text-sm">
      <span className={`w-2 h-2 rounded-full shrink-0 ${g.farbe}`} title={g.label} />
      <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{fmtDate(e.datum).slice(0, 6)}</span>
      <span className="flex-1 min-w-0 truncate">
        {e.bezeichnung}
        {e.ueberfaellig && <span className="ml-2 text-[11px] text-amber-700">seit letztem Auszug fällig</span>}
      </span>
      <span className={`shrink-0 tabular-nums font-medium ${e.betrag > 0 ? 'text-emerald-700' : ''}`}>
        {e.geschaetzt ? '≈ ' : ''}{e.betrag > 0 ? '+' : '–'} {eur(Math.abs(e.betrag))}
      </span>
    </div>
  );
}

export default function LiquiditaetPage() {
  const [buchungen, setBuchungen] = useState<LiqBuchung[]>([]);
  const [auszuege, setAuszuege] = useState<LiqAuszug[]>([]);
  const [posten, setPosten] = useState<LiqPosten[]>([]);
  const [steuer, setSteuer] = useState<LiqSteuer[]>([]);
  const [docs, setDocs] = useState<RechnungLite[]>([]);
  const [angebote, setAngebote] = useState<AngebotLite[]>([]);
  const [wartung, setWartung] = useState<WartungLite[]>([]);
  const [vertraege, setVertraege] = useState<VertragLite[]>([]);
  const [volumen, setVolumen] = useState<VolumenLite[]>([]);
  const [mitNeu, setMitNeu] = useState(false);
  const [laden, setLaden] = useState(true);
  const [upload, setUpload] = useState(false);
  const [alleZeigen, setAlleZeigen] = useState(false);
  const datei = useRef<HTMLInputElement>(null);
  const heute = iso(new Date());

  const neuLaden = useCallback(async () => {
    const seit = monatDazu(heute, -14);
    const [b, a, p, s, d, an, w, ve, vo] = await Promise.all([
      db.from('liq_buchungen').select('konto,datum,betrag,partner,text').gte('datum', seit).order('datum').limit(10000),
      db.from('liq_auszuege').select('konto,stand_am,saldo,bezeichnung').order('stand_am'),
      db.from('liq_posten').select('*').order('naechste_am'),
      db.from('liq_steuer').select('*').order('faellig_am'),
      db.from('documents').select('id,kind,status,number,recipient_company,recipient_name,gross,vat,paid_amount,doc_date,due_date,rest_offen,rest_faellig_am,projekt_id,source_document,project_total,created_at')
        .in('kind', ['invoice', 'partial_invoice', 'final_invoice', 'credit_note']).gte('doc_date', seit).limit(5000),
      db.from('documents').select('id,number,recipient_company,recipient_name,net,gross,status').eq('kind', 'offer').eq('status', 'accepted').gte('doc_date', seit),
      db.from('wartungsvertraege').select('kunde,start_am,monatlich_netto,status,abgerechnet_bis'),
      db.from('contracts').select('party_company,customer_signed_at,support_months,maintenance_monthly,document_id,status').eq('status', 'signed'),
      db.from('order_volumes').select('year,month,amount,source').gte('year', Number(seit.slice(0, 4))),
    ]);
    const num = <T,>(rows: T[] | null, felder: string[]) => (rows || []).map((r: any) => {
      const x = { ...r }; for (const f of felder) if (x[f] != null) x[f] = Number(x[f]); return x as T;
    });
    setBuchungen(num(b.data, ['betrag']));
    setAuszuege(num(a.data, ['saldo']));
    setPosten(num(p.data, ['betrag']));
    setSteuer(num(s.data, ['u_betrag', 'k_betrag', 'e_betrag', 'gesamt']));
    setDocs(num(d.data, ['gross', 'vat', 'paid_amount', 'rest_offen', 'project_total']));
    setVolumen(num(vo.data, ['amount']));
    setAngebote(num(an.data, ['net', 'gross']));
    setWartung(num(w.data, ['monatlich_netto']));
    setVertraege(num(ve.data, ['maintenance_monthly', 'support_months']));
    setLaden(false);
  }, [heute]);
  useEffect(() => { neuLaden(); }, [neuLaden]);

  const v = useMemo(() => berechneVorschau({ buchungen, auszuege, posten, steuer, docs, heute, angebote, wartung, vertraege,
    auftragsvolumen: volumen, szenario: mitNeu ? 'mitNeugeschaeft' : 'gesichert' }),
    [buchungen, auszuege, posten, steuer, docs, heute, angebote, wartung, vertraege, volumen, mitNeu]);
  // Reichweite: nur Gesichertes, 6 Jahre weit – wann wäre das Konto leer, wenn kein neuer Auftrag dazukommt?
  const reichweite = useMemo(() => {
    const lang = berechneVorschau({ buchungen, auszuege, posten, steuer, docs, heute, angebote, wartung, vertraege, monateVoraus: 72 });
    return lang?.monate.find((m) => m.ende < 0)?.monat ?? null;
  }, [buchungen, auszuege, posten, steuer, docs, heute, angebote, wartung, vertraege]);
  const kk = useMemo(() => kreditkarteNachHaendler(buchungen, heute), [buchungen, heute]);

  const verlauf = useMemo(() => {
    if (!v) return [];
    let s = v.start.saldo;
    const pkt = [{ datum: v.start.datum, saldo: s }];
    for (const e of v.ereignisse) { s += e.betrag; const l = pkt[pkt.length - 1]; if (l.datum === e.datum) l.saldo = s; else pkt.push({ datum: e.datum, saldo: s }); }
    return pkt.map((p) => ({ ...p, saldo: Math.round(p.saldo) }));
  }, [v]);

  /* ── Hochladen ── */
  const hochladen = async (files: FileList | null) => {
    if (!files?.length) return;
    setUpload(true);
    try {
      let neu = 0, gesamt = 0; const staende: LiqAuszug[] = [];
      for (const f of Array.from(files)) {
        const buf = await f.arrayBuffer();
        let liste: LiqBuchung[] = [];
        if (/\.pdf$/i.test(f.name)) {
          const r = parseAuszugZeilen(await pdfZeilen(buf));
          liste = r.buchungen; staende.push(...r.auszuege);
          if (!liste.length) toast.error(`${f.name}: keine Buchungen erkannt – ist das ein Sparkassen-Kontoauszug?`);
        } else {
          liste = parseCsv(dateiText(buf));
        }
        const mitSchluessel = schluesselVergeben(liste);
        gesamt += mitSchluessel.length;
        for (let i = 0; i < mitSchluessel.length; i += 500) {
          const { data, error } = await db.from('liq_buchungen')
            .upsert(mitSchluessel.slice(i, i + 500), { onConflict: 'schluessel', ignoreDuplicates: true }).select('id');
          if (error) throw error;
          neu += data?.length || 0;
        }
      }
      if (staende.length) {
        const { error } = await db.from('liq_auszuege').upsert(staende, { onConflict: 'konto,stand_am' });
        if (error) throw error;
      }
      const letzter = staende.sort((a, b) => a.stand_am.localeCompare(b.stand_am)).pop();
      toast.success(`${neu} neue Umsätze (${gesamt - neu} waren schon da)${letzter ? ` · Kontostand ${eur(letzter.saldo)} vom ${fmtDate(letzter.stand_am)}` : ''}`);
      await neuLaden();
    } catch (e) {
      toast.error('Einlesen fehlgeschlagen: ' + ((e as Error).message || e));
    } finally { setUpload(false); if (datei.current) datei.current.value = ''; }
  };

  /* ── Posten ── */
  const [np, setNp] = useState({ bezeichnung: '', betrag: '', richtung: 'aus' as 'aus' | 'ein', intervall: 1, datum: monatDazu(heute, 1), gruppe: 'fix', privat: false });
  const postenSpeichern = async () => {
    const b = Number(np.betrag.replace(/\./g, '').replace(',', '.'));
    if (!np.bezeichnung.trim() || !b) return toast.error('Bezeichnung und Betrag eintragen');
    const { error } = await db.from('liq_posten').insert({
      bezeichnung: np.bezeichnung.trim(), betrag: np.richtung === 'aus' ? -Math.abs(b) : Math.abs(b), intervall_monate: np.intervall,
      naechste_am: np.datum, gruppe: np.privat ? 'privat' : np.gruppe, privat: np.privat,
    });
    if (error) return toast.error('Speichern fehlgeschlagen');
    setNp({ ...np, bezeichnung: '', betrag: '' });
    neuLaden();
  };
  const postenAendern = async (id: string, patch: Partial<LiqPosten>) => { await db.from('liq_posten').update(patch).eq('id', id); neuLaden(); };
  const postenLoeschen = async (id: string) => { await db.from('liq_posten').delete().eq('id', id); neuLaden(); };
  const musterUebernehmen = async (m: Muster, aktiv: boolean) => {
    const partner = m.bezeichnung.split(' – ')[0];
    await db.from('liq_posten').insert({
      bezeichnung: m.bezeichnung, betrag: m.betrag, intervall_monate: 1, naechste_am: monatDazu(m.letzte_am, 1),
      gruppe: m.betrag > 0 ? 'einnahme' : 'fix', muster: partner, aktiv,
      notiz: aktiv ? 'aus dem Kontoauszug übernommen' : 'ausgeblendet – nicht einplanen',
    });
    neuLaden();
  };

  /* ── Finanzamt-Mail eintragen ── */
  const [ns, setNs] = useState({ faellig: monatDazu(heute.slice(0, 8) + '15', 1), uMonat: monatDazu(heute.slice(0, 8) + '01', -1).slice(0, 7), u: '', k: '', e: '', privat: false });
  const steuerSpeichern = async () => {
    const z = (s: string) => (s.trim() ? Number(s.replace(/\./g, '').replace(',', '.')) : null);
    const u = z(ns.u), k = z(ns.k), e = z(ns.e);
    const gesamt = (u || 0) + (k || 0) + (e || 0);
    if (!gesamt && u == null) return toast.error('Mindestens einen Betrag eintragen');
    const { error } = await db.from('liq_steuer').upsert({
      steuernummer: ns.privat ? 'privat' : 'firma', faellig_am: ns.faellig, u_monat: u != null ? ns.uMonat + '-01' : null,
      u_betrag: u, k_betrag: k, e_betrag: e, gesamt,
    }, { onConflict: 'steuernummer,faellig_am' });
    if (error) return toast.error('Speichern fehlgeschlagen');
    toast.success('Zahlung eingetragen – die Schätzung rechnet ab jetzt damit');
    setNs({ ...ns, u: '', k: '', e: '' });
    neuLaden();
  };

  /* ── Kontostand von Hand (z. B. nach CSV ohne Saldo) ── */
  const [ks, setKs] = useState({ datum: heute, saldo: '' });
  const kontostandSpeichern = async () => {
    const s = Number(ks.saldo.replace(/\./g, '').replace(',', '.'));
    if (!ks.saldo.trim() || !Number.isFinite(s)) return;
    await db.from('liq_auszuege').upsert({ konto: 'giro', stand_am: ks.datum, saldo: s, bezeichnung: 'von Hand' }, { onConflict: 'konto,stand_am' });
    setKs({ ...ks, saldo: '' });
    neuLaden();
  };

  if (laden) return <div className="min-h-screen bg-background"><BillingNav /><p className="p-6 text-muted-foreground">Laden …</p></div>;

  const in30 = v ? v.start.saldo + v.ereignisse.filter((e) => e.datum <= monatDazu(heute, 1)).reduce((s, e) => s + e.betrag, 0) : 0;
  const naechste = v ? v.ereignisse.filter((e) => e.datum <= monatDazu(heute, 2)) : [];
  const fixMonat = v ? v.muster.filter((m) => m.betrag < 0).reduce((s, m) => s + m.betrag, 0)
    + posten.filter((p) => p.aktiv && !p.privat && p.intervall_monate > 0 && p.gruppe !== 'finanzamt' && p.gruppe !== 'steuerberater').reduce((s, p) => s + p.betrag / p.intervall_monate, 0) : 0;
  const stbPosten = posten.filter((p) => p.gruppe === 'steuerberater');
  const stbMonat = stbPosten.filter((p) => p.aktiv && p.intervall_monate > 0).reduce((s, p) => s + p.betrag / p.intervall_monate, 0);
  const privPosten = posten.filter((p) => p.privat);
  const privMonat = privPosten.filter((p) => p.aktiv && p.intervall_monate > 0).reduce((s, p) => s + p.betrag / p.intervall_monate, 0);
  const firmaPosten = posten.filter((p) => !p.privat && p.gruppe !== 'steuerberater');
  const kkSumme = kk.reduce((s, x) => s + x.proMonat, 0);
  const gesichert = v ? v.ereignisse.filter((e) => ['rechnung', 'rest', 'wartung'].includes(e.art)) : [];
  const gesichertSumme = gesichert.reduce((s, e) => s + e.betrag, 0);
  const mails = steuer.filter((s) => s.steuernummer === 'firma').slice(-4).reverse();

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold mb-1">Liquidität</h1>
            <p className="text-sm text-muted-foreground">
              Was am Firmenkonto noch rauf- und runterkommt. Jeden Monat einfach den Kontoauszug (PDF) und die
              Kreditkarten-CSV aus George hochladen.
            </p>
          </div>
          <div>
            <input ref={datei} type="file" accept=".pdf,.csv" multiple hidden onChange={(e) => hochladen(e.target.files)} />
            <Button onClick={() => datei.current?.click()} disabled={upload} className="gap-2">
              {upload ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Auszug hochladen
            </Button>
          </div>
        </div>

        {!v ? (
          <Card className="p-6 text-sm text-muted-foreground">Noch kein Kontoauszug da – lade oben den letzten Auszug als PDF hoch.</Card>
        ) : (<>
          {/* Kennzahlen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4 bg-primary/5 border-primary/30">
              <div className="text-xs text-muted-foreground">Kontostand</div>
              <div className="text-2xl font-bold tabular-nums">{eur(v.start.saldo)}</div>
              <div className="text-[11px] text-muted-foreground">laut Auszug vom {fmtDate(v.start.auszug)}{v.start.nachAuszug ? ` + ${v.start.nachAuszug} Umsätze danach` : ''}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">In 30 Tagen</div>
              <div className="text-2xl font-bold tabular-nums">{eur(in30)}</div>
              <div className="text-[11px] text-muted-foreground">voraussichtlich</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Tiefster Stand (12 Monate)</div>
              <div className={`text-2xl font-bold tabular-nums ${v.tiefster.saldo < 10000 ? 'text-red-600' : ''}`}>{eur(v.tiefster.saldo)}</div>
              <div className="text-[11px] text-muted-foreground">am {fmtDate(v.tiefster.datum)}</div>
              <div className="text-[11px] mt-1">
                Ohne neue Aufträge reicht das Geld {reichweite ? <b>bis {MONATE[Number(reichweite.slice(5, 7)) - 1]} {reichweite.slice(0, 4)}</b> : <b>über 6 Jahre</b>}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Fixkosten pro Monat</div>
              <div className="text-2xl font-bold tabular-nums">{eur(Math.abs(fixMonat + v.variabelSchnitt))}</div>
              <div className="text-[11px] text-muted-foreground">ohne Finanzamt und Steuerberater</div>
            </Card>
          </div>

          {/* Verlauf */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 className="font-semibold">Kontostand voraus</h2>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {mitNeu ? `inkl. Neugeschäft wie bisher (Ø ${eur(v.erwartet.neuSchnitt)} netto/Monat aus dem Auftragsvolumen)` : 'gesicherte Aufträge, Wartung und Daueraufträge'}
                <Button size="sm" variant={mitNeu ? 'secondary' : 'outline'} className="h-7 text-xs" onClick={() => setMitNeu(!mitNeu)}>
                  {mitNeu ? 'Nur gesichert' : '+ Neugeschäft wie bisher'}
                </Button>
              </span>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={verlauf} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="liqFarbe" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="datum" tickFormatter={(d) => monatName(d)} minTickGap={40} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tickFormatter={kurz} width={40} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip formatter={(x: number) => [eur(x), 'Kontostand']} labelFormatter={(d) => fmtDate(String(d))} />
                  <Area type="stepAfter" dataKey="saldo" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#liqFarbe)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Gesicherte Einnahmen */}
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <h2 className="font-semibold">Gesichertes Geld, das noch kommt</h2>
              <span className="text-lg font-bold tabular-nums text-emerald-700">+ {eur(gesichertSumme)}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Offene Rechnungen, Restzahlungen aus angenommenen Aufträgen (Restrechnung + 14 Tage) und Wartungs-Jahresrechnungen –
              alles brutto. Dazu laufend: {v.muster.filter((m) => m.betrag > 0 && !m.schwankend).map((m) => `${m.bezeichnung} ${eur(m.betrag)}/Monat`).join(', ') || '–'}.
            </p>
            <div className="divide-y">{gesichert.map((e, i) => <Zeile key={i} e={e} />)}</div>
            {v.ohneTermin.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Gesichert, aber ohne Termin (nicht im Kontostand): {v.ohneTermin.map((o) => `${o.bezeichnung} ${eur(o.betrag)}`).join(' · ')}
              </p>
            )}
          </Card>

          <div className="grid md:grid-cols-5 gap-4">
            {/* Nächste Zahlungen */}
            <Card className="p-4 md:col-span-3">
              <h2 className="font-semibold mb-1">Die nächsten 2 Monate</h2>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground mb-2">
                {['einnahme', 'fix', 'finanzamt', 'steuerberater', 'variabel'].map((g) => (
                  <span key={g} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${GRUPPEN[g].farbe}`} />{GRUPPEN[g].label}</span>
                ))}
                <span>≈ geschätzt</span>
              </div>
              <div className="divide-y">
                {(alleZeigen ? naechste : naechste.slice(0, 25)).map((e, i) => <Zeile key={i} e={e} />)}
              </div>
              {naechste.length > 25 && (
                <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAlleZeigen(!alleZeigen)}>
                  {alleZeigen ? 'Weniger' : `Alle ${naechste.length} zeigen`}
                </Button>
              )}
            </Card>

            {/* Monate */}
            <Card className="p-4 md:col-span-2">
              <h2 className="font-semibold mb-2">Monat für Monat</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr><th className="text-left font-normal pb-1">Monat</th><th className="text-right font-normal">Rein</th><th className="text-right font-normal">Raus</th><th className="text-right font-normal">Finanzamt</th><th className="text-right font-normal">Stand</th></tr>
                  </thead>
                  <tbody>
                    {v.monate.map((m) => (
                      <tr key={m.monat} className="border-t">
                        <td className="py-1">{monatName(m.monat)}</td>
                        <td className="text-right text-emerald-700">{kurz(m.ein)}</td>
                        <td className="text-right">{kurz(Math.abs(m.aus))}</td>
                        <td className="text-right text-amber-700">{kurz(Math.abs(m.finanzamt))}</td>
                        <td className="text-right font-medium">{kurz(m.ende)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Finanzamt */}
          <Card className="p-4">
            <h2 className="font-semibold flex items-center gap-2"><Landmark className="w-4 h-4" /> Finanzamt – Firma (StNr 71 259/0355)</h2>
            <div className="grid md:grid-cols-3 gap-4 mt-3 text-sm">
              <div className="space-y-1 text-muted-foreground">
                <p><b className="text-foreground">Umsatzsteuer:</b> die Steuer eines Monats zahlst du am <b className="text-foreground">15. des übernächsten Monats</b> (Oktober → 15. Dezember).</p>
                <p>Sie ist immer USt aus deinen Rechnungen <b>minus</b> Vorsteuer aus deinen Ausgaben. Im Schnitt der letzten Monate ziehst du rund <b className="text-foreground">{eur(v.vorsteuerSchnitt)}</b> Vorsteuer ab.</p>
                <p><b className="text-foreground">Körperschaftsteuer:</b> fixe Vorauszahlung je Quartal am 15.2., 15.5., 15.8. und 15.11.</p>
                <p><b className="text-foreground">Lohnabgaben:</b> DB und DZ für dein Gehalt jeden Monat, dazu Kommunalsteuer an die Gemeinde.</p>
              </div>
              <div className="md:col-span-2 overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr><th className="text-left font-normal pb-1">USt für</th><th className="text-right font-normal">aus Rechnungen</th><th className="text-right font-normal">− Vorsteuer</th><th className="text-right font-normal">= zahlen</th><th className="text-right font-normal">am</th></tr>
                  </thead>
                  <tbody>
                    {v.ust.filter((u) => !u.geschaetzt || u.faellig <= monatDazu(heute, 6)).map((u) => (
                      <tr key={u.monat} className={`border-t ${u.geschaetzt ? 'text-muted-foreground' : ''}`}>
                        <td className="py-1">{monatName(u.monat)}{u.geschaetzt ? ' ≈' : ''}</td>
                        <td className="text-right">{eur(u.ust)}</td>
                        <td className="text-right">{u.vorsteuer != null ? eur(u.vorsteuer) : '–'}</td>
                        <td className="text-right font-medium text-foreground">{u.zahllast == null ? '–' : u.zahllast < 0 ? `Gutschrift ${eur(-u.zahllast)}` : eur(u.zahllast)}</td>
                        <td className="text-right">{fmtDate(u.faellig).slice(0, 6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-muted-foreground mt-1">≈ geschätzt aus deinen Rechnungen; schwarz = Betrag laut Steuerberater.</p>
              </div>
            </div>

            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Neue „Zahlung Finanzamt“-Mail vom Steuerberater eintragen</summary>
              <div className="flex flex-wrap gap-2 items-end mt-2">
                <div><Label className="text-xs text-muted-foreground">Fällig am</Label><Input type="date" value={ns.faellig} onChange={(e) => setNs({ ...ns, faellig: e.target.value })} /></div>
                <div><Label className="text-xs text-muted-foreground">USt für Monat</Label><Input type="month" value={ns.uMonat} onChange={(e) => setNs({ ...ns, uMonat: e.target.value })} /></div>
                <div className="w-28"><Label className="text-xs text-muted-foreground">U (USt) €</Label><Input value={ns.u} onChange={(e) => setNs({ ...ns, u: e.target.value })} placeholder="0,00" /></div>
                <div className="w-28"><Label className="text-xs text-muted-foreground">K (KöSt) €</Label><Input value={ns.k} onChange={(e) => setNs({ ...ns, k: e.target.value })} placeholder="–" /></div>
                {ns.privat && <div className="w-28"><Label className="text-xs text-muted-foreground">E (ESt) €</Label><Input value={ns.e} onChange={(e) => setNs({ ...ns, e: e.target.value })} placeholder="–" /></div>}
                <label className="flex items-center gap-1 text-xs pb-2"><input type="checkbox" checked={ns.privat} onChange={(e) => setNs({ ...ns, privat: e.target.checked })} /> privat</label>
                <Button size="sm" onClick={steuerSpeichern} className="gap-1"><Plus className="w-4 h-4" /> Eintragen</Button>
              </div>
              {mails.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Zuletzt: {mails.map((m) => `${fmtDate(m.faellig_am).slice(0, 6)} ${eur(m.gesamt)}`).join(' · ')}
                </p>
              )}
            </details>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Steuerberater */}
            <Card className="p-4">
              <h2 className="font-semibold">Steuerberater (Zangrando-Jaklitsch)</h2>
              <p className="text-sm text-muted-foreground mb-2">Im Schnitt <b className="text-foreground">{eur(Math.abs(stbMonat))}</b> pro Monat – Rechnungen kommen als „Honorarnote“ alle paar Monate.</p>
              <PostenListe liste={stbPosten} aendern={postenAendern} loeschen={postenLoeschen} />
            </Card>

            {/* Privat */}
            <Card className="p-4">
              <h2 className="font-semibold">Privat (StNr 71 169/6385)</h2>
              <p className="text-sm text-muted-foreground mb-2">
                Zählt <b>nicht</b> zum Firmenkonto. Unterm Strich bleiben dir im Schnitt <b className="text-foreground">{eur(privMonat)}</b> pro Monat.
              </p>
              <PostenListe liste={privPosten} aendern={postenAendern} loeschen={postenLoeschen} />
            </Card>
          </div>

          {/* Fixkosten */}
          <Card className="p-4">
            <h2 className="font-semibold">Regelmäßige Zahlungen</h2>
            <p className="text-sm text-muted-foreground mb-3 flex gap-1.5"><Info className="w-4 h-4 shrink-0 mt-0.5" />
              Aus den Kontoauszügen erkannt: was mindestens 3 Monate gleich wiederkommt. Passt etwas nicht, blende es aus – oder übernimm es als Posten und ändere dort den Betrag.</p>
            <div className="divide-y text-sm">
              {v.muster.map((m) => (
                <div key={m.key} className="flex items-center gap-2 py-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${m.betrag > 0 ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                  <span className="flex-1 min-w-0 truncate">{m.bezeichnung}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">um den {m.tag}. · {m.monate} von 6 Mon.{m.schwankend ? ' · schwankt' : ''}</span>
                  <span className={`tabular-nums shrink-0 w-24 text-right ${m.betrag > 0 ? 'text-emerald-700' : ''}`}>{m.schwankend ? '≈ ' : ''}{eur(m.betrag)}</span>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => musterUebernehmen(m, true)}>übernehmen</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="nicht einplanen" onClick={() => musterUebernehmen(m, false)}><EyeOff className="w-4 h-4" /></Button>
                </div>
              ))}
              <div className="flex items-center gap-2 py-1.5 text-muted-foreground">
                <span className="w-2 h-2 rounded-full shrink-0 bg-slate-300" />
                <span className="flex-1">Sonstige laufende Ausgaben (Tanken, Amazon, Post … Schnitt 3 Monate)</span>
                <span className="tabular-nums w-24 text-right">≈ {eur(v.variabelSchnitt)}</span>
              </div>
            </div>
            <h3 className="font-medium text-sm mt-4 mb-1">Eigene Posten</h3>
            <PostenListe liste={firmaPosten} aendern={postenAendern} loeschen={postenLoeschen} />
            <div className="flex flex-wrap gap-2 items-end mt-3 pt-3 border-t">
              <div className="flex-1 min-w-[160px]"><Label className="text-xs text-muted-foreground">Bezeichnung</Label><Input value={np.bezeichnung} onChange={(e) => setNp({ ...np, bezeichnung: e.target.value })} placeholder="z. B. Laptop, Versicherung …" /></div>
              <div className="flex gap-1">
                <Button size="sm" variant={np.richtung === 'aus' ? 'secondary' : 'outline'} onClick={() => setNp({ ...np, richtung: 'aus' })}>Ausgabe</Button>
                <Button size="sm" variant={np.richtung === 'ein' ? 'secondary' : 'outline'} onClick={() => setNp({ ...np, richtung: 'ein' })}>Eingang</Button>
              </div>
              <div className="w-28"><Label className="text-xs text-muted-foreground">Betrag €</Label><Input value={np.betrag} onChange={(e) => setNp({ ...np, betrag: e.target.value })} placeholder="0,00" /></div>
              <div><Label className="text-xs text-muted-foreground">Wie oft</Label>
                <select className="h-10 rounded-md border bg-background px-2 text-sm" value={np.intervall} onChange={(e) => setNp({ ...np, intervall: Number(e.target.value) })}>
                  {INTERVALLE.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              </div>
              <div><Label className="text-xs text-muted-foreground">{np.intervall ? 'Nächstes Mal' : 'Am'}</Label><Input type="date" value={np.datum} onChange={(e) => setNp({ ...np, datum: e.target.value })} /></div>
              <div><Label className="text-xs text-muted-foreground">Art</Label>
                <select className="h-10 rounded-md border bg-background px-2 text-sm" value={np.privat ? 'privat' : np.gruppe} onChange={(e) => setNp({ ...np, gruppe: e.target.value === 'privat' ? 'fix' : e.target.value, privat: e.target.value === 'privat' })}>
                  <option value="fix">Firma</option><option value="steuerberater">Steuerberater</option><option value="finanzamt">Finanzamt</option><option value="privat">Privat</option>
                </select>
              </div>
              <Button size="sm" onClick={postenSpeichern} className="gap-1"><Plus className="w-4 h-4" /> Dazu</Button>
            </div>
          </Card>

          {/* Kreditkarte */}
          {kk.length > 0 && (
            <Card className="p-4">
              <h2 className="font-semibold">Kreditkarte – wofür im Monat</h2>
              <p className="text-sm text-muted-foreground mb-2">Schnitt der letzten 3 Monate, zusammen ca. <b className="text-foreground">{eur(Math.abs(kkSumme))}</b>. Wird jeweils um den 5. vom Konto abgebucht.</p>
              <div className="grid sm:grid-cols-2 gap-x-6 text-sm">
                {kk.slice(0, 16).map((x) => (
                  <div key={x.haendler} className="flex justify-between py-0.5 border-b border-dashed">
                    <span className="truncate">{x.haendler}</span><span className="tabular-nums">{eur(Math.abs(x.proMonat))}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Kontostand von Hand eintragen (wenn du nur eine CSV ohne Kontostand hochgeladen hast)</summary>
            <div className="flex flex-wrap gap-2 items-end mt-2">
              <div><Label className="text-xs text-muted-foreground">Stand am</Label><Input type="date" value={ks.datum} onChange={(e) => setKs({ ...ks, datum: e.target.value })} /></div>
              <div className="w-36"><Label className="text-xs text-muted-foreground">Kontostand €</Label><Input value={ks.saldo} onChange={(e) => setKs({ ...ks, saldo: e.target.value })} /></div>
              <Button size="sm" onClick={kontostandSpeichern}>Speichern</Button>
            </div>
          </details>
        </>)}
      </main>
    </div>
  );
}

function PostenListe({ liste, aendern, loeschen }: {
  liste: LiqPosten[]; aendern: (id: string, p: Partial<LiqPosten>) => void; loeschen: (id: string) => void;
}) {
  const [bearbeiten, setBearbeiten] = useState<string | null>(null);
  const [wert, setWert] = useState('');
  if (!liste.length) return <p className="text-sm text-muted-foreground">Keine Posten.</p>;
  return (
    <div className="divide-y text-sm">
      {liste.map((p) => (
        <div key={p.id} className={`flex items-center gap-2 py-1.5 ${p.aktiv ? '' : 'opacity-50'}`}>
          <div className="flex-1 min-w-0">
            <div className="truncate" title={p.notiz || undefined}>{p.bezeichnung}</div>
            <div className="text-[11px] text-muted-foreground">{intervallText(p.intervall_monate)}{p.intervall_monate ? ', nächstes Mal' : ''} {fmtDate(p.naechste_am)}{p.aktiv ? '' : ' · ausgeblendet'}</div>
          </div>
          {bearbeiten === p.id ? (
            <Input autoFocus className="w-28 h-8" value={wert} onChange={(e) => setWert(e.target.value)}
              onBlur={() => { const n = Number(wert.replace(/\./g, '').replace(',', '.')); if (Number.isFinite(n) && wert.trim()) aendern(p.id, { betrag: Math.sign(p.betrag || -1) * Math.abs(n) }); setBearbeiten(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          ) : (
            <button className={`tabular-nums shrink-0 hover:underline ${p.betrag > 0 ? 'text-emerald-700' : ''}`} title="Betrag ändern"
              onClick={() => { setBearbeiten(p.id); setWert(String(Math.abs(p.betrag)).replace('.', ',')); }}>
              {p.betrag > 0 ? '+' : '–'} {eur(Math.abs(p.betrag))}
            </button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" title={p.aktiv ? 'nicht einplanen' : 'wieder einplanen'} onClick={() => aendern(p.id, { aktiv: !p.aktiv })}>
            {p.aktiv ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="löschen" onClick={() => loeschen(p.id)}><Trash2 className="w-4 h-4" /></Button>
        </div>
      ))}
    </div>
  );
}
