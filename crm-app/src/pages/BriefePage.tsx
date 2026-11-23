/**
 * Briefe & QR-Scans – wer hat den QR-Code im Brief wann und wie oft aufgerufen (23.11.2026).
 *
 * Jeder Brief hat einen eigenen Code (epowergmbh.at/q/<code>). Das Brief-Werkzeug
 * (~/Developer/brief/<aktion>/erzeuge.mjs) legt die Codes samt Firma in crm.brief_qr an.
 * Jeder Aufruf geht über die Website (api/q.js) an die Edge Function brief-qr → crm.brief_qr_scans.
 * Link-Vorschauen und Bots (WhatsApp, Crawler …) sind markiert und zählen nicht mit.
 * Anfragen: Leads, bei denen die Website den Code als ad_name mitgeschickt hat (utm_content)
 * oder deren Kampagne passt.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AppNav } from '@/components/AppNav';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { STAGE_LABELS } from '@/types/lead';
import { QrCode, Search, ChevronDown, ChevronRight } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface BriefQr { code: string; kampagne: string; firma: string | null; empfaenger: string | null; strasse: string | null; plz: string | null; ort: string | null; erstellt_am: string }
interface Scan { id: number; code: string; gescannt_am: string; geraet: string | null; bot: boolean }
interface BriefLead { id: string; full_name: string; company_name: string | null; ad_name: string | null; campaign_name: string | null; stage: string; created_at: string }

/** PostgREST liefert höchstens 1000 Zeilen am Stück – daher seitenweise holen. */
async function alle<T>(tabelle: string, spalten: string, ordnung: string, filter?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (let von = 0; ; von += 1000) {
    let q = db.from(tabelle).select(spalten).order(ordnung).range(von, von + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

const zeit = (s: string) => new Date(s).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const tagKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tagLabel = (k: string) => new Date(k + 'T12:00:00').toLocaleDateString('de-AT', { day: 'numeric', month: 'short' });

interface Zeile { qr: BriefQr; scans: Scan[]; leads: BriefLead[] }

export default function BriefePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['brief-qr-auswertung'],
    queryFn: async () => {
      const [codes, scans, leads] = await Promise.all([
        alle<BriefQr>('brief_qr', 'code,kampagne,firma,empfaenger,strasse,plz,ort,erstellt_am', 'code'),
        alle<Scan>('brief_qr_scans', 'id,code,gescannt_am,geraet,bot', 'id'),
        alle<BriefLead>('leads', 'id,full_name,company_name,ad_name,campaign_name,stage,created_at', 'created_at', (q) => q.eq('source', 'brief')),
      ]);
      return { codes, scans, leads };
    },
    refetchInterval: 60_000,
  });

  // Kampagnen, neueste zuerst; „test“ (Muster-Code) nur, wenn es sonst nichts gibt.
  const kampagnen = useMemo(() => {
    const zuletzt = new Map<string, string>();
    for (const c of data?.codes ?? []) if ((zuletzt.get(c.kampagne) ?? '') < c.erstellt_am) zuletzt.set(c.kampagne, c.erstellt_am);
    return [...zuletzt.entries()].sort((a, b) => (a[0] === 'test' ? 1 : b[0] === 'test' ? -1 : b[1].localeCompare(a[1]))).map(([k]) => k);
  }, [data]);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const kampagne = gewaehlt ?? kampagnen[0] ?? null;

  const [nurGescannt, setNurGescannt] = useState(true);
  const [suche, setSuche] = useState('');
  const [offen, setOffen] = useState<string | null>(null);

  const a = useMemo(() => {
    if (!data || !kampagne) return null;
    const codes = data.codes.filter((c) => c.kampagne === kampagne);
    const alleCodes = new Set(data.codes.map((c) => c.code));
    const zeilen = new Map<string, Zeile>(codes.map((qr) => [qr.code, { qr, scans: [], leads: [] }]));
    let vorschauen = 0;
    for (const s of data.scans) {
      const z = zeilen.get(s.code);
      if (!z) continue;
      if (s.bot) vorschauen++; else z.scans.push(s);
    }
    const ohneCode: BriefLead[] = [];
    for (const l of data.leads) {
      const z = l.ad_name ? zeilen.get(l.ad_name.toUpperCase()) : undefined;
      if (z) z.leads.push(l);
      else if (l.campaign_name === kampagne) ohneCode.push(l);
    }
    const liste = [...zeilen.values()];
    const gescannt = liste.filter((z) => z.scans.length > 0);
    const echte = liste.flatMap((z) => z.scans.map((s) => ({ s, z }))).sort((x, y) => y.s.gescannt_am.localeCompare(x.s.gescannt_am));

    // Scans je Tag, vom ersten Scan bis heute (Tage ohne Scan als 0, damit die Zeitachse stimmt).
    const proTag = new Map<string, number>();
    for (const { s } of echte) { const k = tagKey(new Date(s.gescannt_am)); proTag.set(k, (proTag.get(k) ?? 0) + 1); }
    const tage: { tag: string; scans: number }[] = [];
    if (echte.length) {
      const d = new Date(echte[echte.length - 1].s.gescannt_am); d.setHours(12, 0, 0, 0);
      const bis = tagKey(new Date());
      for (let i = 0; i < 400; i++) {
        const k = tagKey(d);
        tage.push({ tag: k, scans: proTag.get(k) ?? 0 });
        if (k >= bis) break;
        d.setDate(d.getDate() + 1);
      }
    }
    const unbekannt = data.scans.filter((s) => !s.bot && !alleCodes.has(s.code)).length;
    const anfragen = liste.reduce((n, z) => n + z.leads.length, 0) + ohneCode.length;
    return { liste, gescannt, echte, tage, vorschauen, unbekannt, ohneCode, anfragen, briefe: codes.length };
  }, [data, kampagne]);

  const sichtbar = useMemo(() => {
    if (!a) return [];
    const s = suche.trim().toLowerCase();
    return a.liste
      .filter((z) => !nurGescannt || z.scans.length > 0 || z.leads.length > 0)
      .filter((z) => !s || [z.qr.firma, z.qr.empfaenger, z.qr.ort, z.qr.plz, z.qr.code].some((v) => v?.toLowerCase().includes(s)))
      .sort((x, y) => (y.scans[y.scans.length - 1]?.gescannt_am ?? '').localeCompare(x.scans[x.scans.length - 1]?.gescannt_am ?? '')
        || (x.qr.firma ?? '').localeCompare(y.qr.firma ?? ''));
  }, [a, nurGescannt, suche]);

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><QrCode className="w-6 h-6" /> Briefe & QR-Scans</h1>
            <p className="text-sm text-muted-foreground">Jeder Brief hat einen eigenen QR-Code – hier siehst du, welche Firma ihn wann und wie oft aufgerufen hat.</p>
          </div>
          {kampagnen.length > 1 && (
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={kampagne ?? ''} onChange={(e) => { setGewaehlt(e.target.value); setOffen(null); }}>
              {kampagnen.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
        </div>

        {error && <Card className="p-4 text-sm text-red-700">Laden fehlgeschlagen: {String((error as Error).message ?? error)}</Card>}
        {isLoading && <p className="text-muted-foreground">Wird geladen …</p>}
        {!isLoading && !error && !a && <Card className="p-8 text-center text-muted-foreground">Noch keine Briefaktion mit QR-Codes angelegt.</Card>}

        {a && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {[
                ['Briefe', String(a.briefe), kampagne ?? ''],
                ['Firmen gescannt', String(a.gescannt.length), a.briefe ? `${(a.gescannt.length / a.briefe * 100).toLocaleString('de-AT', { maximumFractionDigits: 1 })} % der Briefe` : ''],
                ['Scans gesamt', String(a.echte.length), a.vorschauen ? `${a.vorschauen} ${a.vorschauen === 1 ? 'Link-Vorschau' : 'Link-Vorschauen'} nicht gezählt` : 'ohne Link-Vorschauen'],
                ['Anfragen', String(a.anfragen), 'Formular nach dem Scan'],
              ].map(([t, w, u]) => (
                <Card key={t} className="p-3">
                  <div className="text-[11px] text-muted-foreground">{t}</div>
                  <div className="text-xl font-bold tabular-nums">{w}</div>
                  {u && <div className="text-[11px] text-muted-foreground truncate">{u}</div>}
                </Card>
              ))}
            </div>

            <Card className="p-3 mb-4">
              <div className="text-sm font-semibold mb-2">Scans je Tag</div>
              {a.tage.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Noch kein Scan – sobald jemand den Code mit dem Handy aufruft, steht er hier.</p>
              ) : (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={a.tage} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="tag" tickFormatter={tagLabel} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} minTickGap={16} />
                      <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--muted))' }}
                        labelFormatter={(k) => new Date(String(k) + 'T12:00:00').toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'long' })}
                        formatter={(v) => [`${v} ${Number(v) === 1 ? 'Scan' : 'Scans'}`, '']}
                        separator=""
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="scans" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="p-3 lg:col-span-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <div className="text-sm font-semibold flex-1">{nurGescannt ? 'Wer hat gescannt' : 'Alle Briefe'}</div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
                    <Input className="h-8 w-48 pl-7 text-sm" placeholder="Firma, Ort, Code …" value={suche} onChange={(e) => setSuche(e.target.value)} />
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setNurGescannt((v) => !v)}>
                    {nurGescannt ? `Alle ${a.briefe} Briefe zeigen` : 'Nur gescannte'}
                  </Button>
                </div>
                <div className="divide-y">
                  {sichtbar.map((z) => {
                    const erster = z.scans[0]; const letzter = z.scans[z.scans.length - 1];
                    const geraete = [...new Set(z.scans.map((s) => s.geraet ?? 'unbekannt'))];
                    const auf = offen === z.qr.code;
                    return (
                      <div key={z.qr.code} className="py-2">
                        <button type="button" className="w-full text-left flex flex-wrap items-start gap-x-3 gap-y-1" onClick={() => setOffen(auf ? null : z.qr.code)} disabled={!z.scans.length && !z.leads.length}>
                          <span className="pt-0.5 text-muted-foreground">{z.scans.length || z.leads.length ? (auf ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <span className="inline-block w-4" />}</span>
                          <div className="flex-1 min-w-[180px]">
                            <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                              {z.qr.firma ?? z.qr.code}
                              {z.leads.length > 0 && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 text-[10px]">Anfrage</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground">{[z.qr.empfaenger, [z.qr.plz, z.qr.ort].filter(Boolean).join(' ')].filter(Boolean).join(' · ')} · <span className="font-mono">{z.qr.code}</span></div>
                          </div>
                          <div className="w-full sm:w-auto pl-7 sm:pl-0 text-xs tabular-nums flex flex-wrap gap-x-2 sm:block sm:text-right">
                            {z.scans.length ? (
                              <>
                                <div className="text-sm font-semibold">{z.scans.length}× gescannt</div>
                                <div className="text-muted-foreground">zuletzt {zeit(letzter.gescannt_am)}</div>
                                {z.scans.length > 1 && <div className="text-muted-foreground">zuerst {zeit(erster.gescannt_am)}</div>}
                                <div className="text-muted-foreground">{geraete.join(', ')}</div>
                              </>
                            ) : <span className="text-muted-foreground">nicht gescannt</span>}
                          </div>
                        </button>
                        {auf && (
                          <div className="ml-7 mt-2 space-y-1 text-xs">
                            {[...z.scans].reverse().map((s) => (
                              <div key={s.id} className="flex gap-3 tabular-nums"><span>{zeit(s.gescannt_am)}</span><span className="text-muted-foreground">{s.geraet ?? 'unbekannt'}</span></div>
                            ))}
                            {z.leads.map((l) => (
                              <div key={l.id} className="text-orange-800">
                                Anfrage am {zeit(l.created_at)}: {l.full_name}{l.company_name ? `, ${l.company_name}` : ''} – {STAGE_LABELS[l.stage as keyof typeof STAGE_LABELS] ?? l.stage} (im CRM)
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {sichtbar.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">{suche ? 'Nichts gefunden.' : 'Noch hat niemand gescannt.'}</p>
                  )}
                </div>
              </Card>

              <Card className="p-3 self-start min-w-0">
                <div className="text-sm font-semibold mb-2">Letzte Scans</div>
                {a.echte.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine.</p> : (
                  <div className="space-y-1.5">
                    {a.echte.slice(0, 40).map(({ s, z }) => (
                      <button key={s.id} type="button" className="w-full text-left text-xs hover:bg-muted/50 rounded px-1 -mx-1 py-0.5"
                        onClick={() => { setOffen(z.qr.code); setNurGescannt(true); setSuche(''); }}>
                        <div className="tabular-nums text-muted-foreground">{zeit(s.gescannt_am)} · {s.geraet ?? 'unbekannt'}</div>
                        <div className="font-medium truncate">{z.qr.firma ?? z.qr.code}{z.qr.ort ? `, ${z.qr.ort}` : ''}</div>
                      </button>
                    ))}
                  </div>
                )}
                {a.ohneCode.length > 0 && (
                  <div className="mt-3 pt-2 border-t text-xs">
                    <div className="font-semibold mb-1">Anfragen ohne Code-Zuordnung</div>
                    {a.ohneCode.map((l) => <div key={l.id}>{zeit(l.created_at)}: {l.full_name}{l.company_name ? `, ${l.company_name}` : ''}</div>)}
                  </div>
                )}
                {a.unbekannt > 0 && <p className="mt-3 text-[11px] text-muted-foreground">{a.unbekannt} Scan{a.unbekannt === 1 ? '' : 's'} mit unbekanntem Code (keiner Aktion zugeordnet).</p>}
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
