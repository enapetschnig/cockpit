/**
 * „Heute" – die Startseite. Nur, was heute Christoph selbst tun muss;
 * alles andere erledigt der Änderungswunsch-Roboter. Jede Gruppe erscheint
 * nur, wenn sie etwas enthält. Liest nur – geändert wird auf den Fachseiten,
 * zu denen jede Zeile führt. Regeln: src/lib/heute.ts
 */
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AppNav } from '@/components/AppNav';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useOpenInvoices } from '@/hooks/useOpenInvoices';
import { useAuftraege } from '@/hooks/useAuftraege';
import { APP_LABEL } from '@/lib/apps';
import { eur, fmtDate } from '@/types/billing';
import {
  ANGEBOT_NACHFASSEN_TAGE, WARTET_AUF_DICH, HeuteAuftrag, HeuteBesprechung, HeuteWunsch,
  besprechungTitel, besprechungenFuerDich, einSatz, freieWuensche, meinePunkte, roboterPuls, roboterSatz,
  tageZwischen, tagVon,
} from '@/lib/heute';
import { Bot, ChevronRight, Inbox, Loader2, Mic, Phone, Wallet } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface LeadZeile {
  id: string; full_name: string | null; company_name: string | null; stage: string;
  callback_date: string | null; callback_set_at: string | null; callback_comment: string | null; meeting_date: string | null;
}
interface Angebot { id: string; number: string | null; doc_date: string; net: number; recipient_company: string | null; recipient_name: string | null }
interface Mahnung { document_id: string; stufe: number; datum: string; frist: string | null }
interface Vertrag { id: string; number: string | null; party_company: string | null; party_name: string | null }

interface Daten {
  auftraege: HeuteAuftrag[];
  puls: { zuletzt: string | null; meldung: string | null } | null;
  wuensche: HeuteWunsch[];
  wunschText: Record<string, string>;
  termine: LeadZeile[];
  rueckrufe: LeadZeile[];
  angebote: Angebot[];
  mahnungen: Record<string, Mahnung>;
  besprechungen: HeuteBesprechung[];
  vertraege: Vertrag[];
  fehler: boolean;
}

const kunde = (k: string) => APP_LABEL[k] ?? k;
const name = (l: { company_name: string | null; full_name: string | null }) => l.company_name || l.full_name || '—';
const uhr = (iso: string) => new Date(iso).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });

function useHeute() {
  const [daten, setDaten] = useState<Daten | null>(null);

  const laden = useCallback(async () => {
    const jetzt = new Date();
    const heute = tagVon(jetzt);
    const start = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()).toISOString();
    const ende = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 1).toISOString();
    const angebotBis = tagVon(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - ANGEBOT_NACHFASSEN_TAGE));

    const [a, p, w, l, o, m, b, v] = await Promise.all([
      db.from('roboter_auftraege')
        .select('id,app_key,wunsch_ids,status,fehler,vorschlag,geprueft,vor_kunde,vor_kunde_ok_am,datenbank,aktualisiert')
        .not('status', 'in', '(verworfen,abgelehnt)').order('aktualisiert', { ascending: false }).limit(1000),
      db.from('roboter_puls').select('zuletzt,meldung').eq('id', 1).maybeSingle(),
      // „offen" wie in der Navigation (useOffeneWuensche)
      db.from('app_wuensche').select('id,app_key,art,text,melder,erstellt_am')
        .not('status', 'in', '("umgesetzt","abgelehnt","geloescht")').is('erledigt_am', null)
        .order('erstellt_am', { ascending: false }).limit(200),
      db.from('leads')
        .select('id,full_name,company_name,stage,callback_date,callback_set_at,callback_comment,meeting_date')
        .not('stage', 'in', '(won,lost)')
        .or(`callback_date.lt.${ende},and(meeting_date.gte.${start},meeting_date.lt.${ende})`).limit(500),
      db.from('documents').select('id,number,doc_date,net,recipient_company,recipient_name')
        .eq('kind', 'offer').in('status', ['draft', 'sent']).is('converted_to', null)
        .lte('doc_date', angebotBis).order('doc_date', { ascending: true }).limit(50),
      db.from('mahnungen').select('document_id,stufe,datum,frist').order('stufe', { ascending: true }),
      db.from('besprechungen').select('id,titel,beginn,status,handlungsschritte')
        .neq('status', 'ignoriert').order('beginn', { ascending: false }).limit(150),
      db.from('contracts').select('id,number,party_company,party_name').eq('status', 'signed').is('signed_seen_at', null),
    ]);

    const leads = (l.data || []) as LeadZeile[];
    const auftraege = (a.data || []) as HeuteAuftrag[];
    const wartend = auftraege.filter((x) => WARTET_AUF_DICH.includes(x.status));
    const erste = [...new Set(wartend.map((x) => x.wunsch_ids[0]).filter(Boolean))];
    const rueckrufIds = leads.filter((x) => x.callback_date).map((x) => x.id);
    const [t, c] = await Promise.all([
      erste.length ? db.from('app_wuensche').select('id,text').in('id', erste) : { data: [] },
      rueckrufIds.length ? db.from('contact_logs').select('lead_id,date').in('lead_id', rueckrufIds) : { data: [] },
    ]);

    // Rückruf erledigt, sobald seit dem Setzen ein Kontakt eingetragen wurde (wie die Rückrufliste im CRM).
    const kontakte = new Map<string, number>();
    for (const k of (c.data || []) as { lead_id: string; date: string }[]) {
      kontakte.set(k.lead_id, Math.max(kontakte.get(k.lead_id) ?? 0, new Date(k.date).getTime()));
    }
    const rueckrufe = leads
      .filter((x) => x.callback_date && tagVon(new Date(x.callback_date)) <= heute)
      .filter((x) => (kontakte.get(x.id) ?? 0) <= new Date(x.callback_set_at || x.callback_date!).getTime())
      .sort((x, y) => x.callback_date!.localeCompare(y.callback_date!));
    const termine = leads
      .filter((x) => x.meeting_date && x.meeting_date >= start && x.meeting_date < ende)
      .sort((x, y) => x.meeting_date!.localeCompare(y.meeting_date!));

    // je Rechnung die höchste Mahnstufe
    const mahnungen: Record<string, Mahnung> = {};
    for (const x of (m.data || []) as Mahnung[]) mahnungen[x.document_id] = x;

    setDaten({
      auftraege, puls: p.data || null,
      wuensche: (w.data || []) as HeuteWunsch[],
      wunschText: Object.fromEntries(((t.data || []) as { id: string; text: string }[]).map((x) => [x.id, x.text])),
      termine, rueckrufe,
      angebote: (o.data || []) as Angebot[],
      mahnungen,
      besprechungen: (b.data || []) as HeuteBesprechung[],
      vertraege: (v.data || []) as Vertrag[],
      fehler: [a, p, w, l, o, m, b, v, t, c].some((r) => r.error),
    });
  }, []);

  useEffect(() => { laden(); const t = setInterval(laden, 60_000); return () => clearInterval(t); }, [laden]);
  return daten;
}

/** Eine Aufgabe = eine Zeile, die dorthin führt, wo man sie erledigt. */
function Zeile({ to, titel, detail, rechts, warn }: { to: string; titel: ReactNode; detail?: ReactNode; rechts?: ReactNode; warn?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium sm:truncate">{titel}</div>
        {detail && <div className="text-xs text-muted-foreground line-clamp-2 sm:line-clamp-1">{detail}</div>}
      </div>
      {rechts && <div className={'text-xs tabular-nums shrink-0 text-right ' + (warn ? 'text-red-600 font-semibold' : 'text-muted-foreground')}>{rechts}</div>}
      <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
    </Link>
  );
}

function Gruppe({ icon: Icon, titel, anzahl, children }: { icon: typeof Bot; titel: string; anzahl: number; children: ReactNode }) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm font-semibold mb-1.5 px-1">
        <Icon className="w-4 h-4 text-muted-foreground" /> {titel}
        <span className="text-xs font-normal text-muted-foreground">{anzahl}</span>
      </h2>
      <Card className="divide-y overflow-hidden">{children}</Card>
    </section>
  );
}

export default function HeutePage() {
  const [sp] = useSearchParams();
  const daten = useHeute();
  const { overdue, open, isLoading: rechnungenLaden } = useOpenInvoices();
  const { faellig: restFaellig, isLoading: auftraegeLaden } = useAuftraege();

  // Alte Links (Telegram „/?lead=…") öffnen weiterhin den Lead im CRM.
  const lead = sp.get('lead');
  if (lead) return <Navigate to={`/crm?lead=${encodeURIComponent(lead)}`} replace />;

  const jetzt = new Date();
  const heute = tagVon(jetzt);
  const datum = jetzt.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });

  if (!daten || rechnungenLaden || auftraegeLaden) {
    return (
      <div className="min-h-screen bg-background">
        <AppNav />
        <main className="max-w-3xl mx-auto px-4 py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></main>
      </div>
    );
  }

  const wartend = daten.auftraege.filter((a) => WARTET_AUF_DICH.includes(a.status));
  const neueWuensche = freieWuensche(daten.wuensche, daten.auftraege);
  const entwuerfe = open.filter((r) => r.status === 'draft' && !overdue.includes(r));
  const besprechungen = besprechungenFuerDich(daten.besprechungen);
  const puls = roboterPuls(daten.puls?.zuletzt);

  const anrufen = daten.termine.length + daten.rueckrufe.length;
  const geld = daten.vertraege.length + overdue.length + restFaellig.length + entwuerfe.length + daten.angebote.length;
  const nichts = !wartend.length && !neueWuensche.length && !anrufen && !geld && !besprechungen.length;

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
          <div>
            <h1 className="text-xl font-semibold">Heute</h1>
            <p className="text-sm text-muted-foreground">{datum}</p>
          </div>
          <Link to="/wuensche" className={'text-xs ' + (puls.laeuft ? 'text-green-700' : 'text-red-600 font-medium')}>
            {puls.laeuft
              ? `● Roboter läuft${daten.puls?.meldung && daten.puls.meldung !== 'bereit' ? ` – ${einSatz(daten.puls.meldung, 60)}` : ''}`
              : puls.minuten === null ? '○ Roboter noch nie gestartet'
              : `○ Roboter steht – seit ${puls.minuten >= 120 ? `${Math.round(puls.minuten / 60)} Std.` : `${puls.minuten} Min.`} kein Lebenszeichen (PC aus?)`}
          </Link>
        </div>

        {nichts && (
          <Card className="p-8 text-center text-sm text-muted-foreground">Heute ist nichts für dich offen.</Card>
        )}

        {wartend.length > 0 && (
          <Gruppe icon={Bot} titel="Roboter wartet auf dich" anzahl={wartend.length}>
            {wartend.map((a) => {
              const s = roboterSatz(a, daten.wunschText[a.wunsch_ids[0]]);
              return <Zeile key={a.id} to={`/wuensche#a-${a.id}`} titel={<>{kunde(a.app_key)} <span className="font-normal text-muted-foreground">· {s.was}</span></>}
                detail={s.satz} />;
            })}
          </Gruppe>
        )}

        {neueWuensche.length > 0 && (
          <Gruppe icon={Inbox} titel="Neue Wünsche – noch ohne Roboter" anzahl={neueWuensche.length}>
            {neueWuensche.map((w) => (
              <Zeile key={w.id} to="/wuensche"
                titel={<>{kunde(w.app_key)}{w.art !== 'wunsch' && <span className="font-normal text-muted-foreground"> · {w.art === 'fehler' ? 'Fehler' : 'Frage'}</span>}</>}
                detail={`„${einSatz(w.text, 140)}“${w.melder ? ` – ${w.melder}` : ''}`}
                rechts={tagVon(new Date(w.erstellt_am)) === heute ? uhr(w.erstellt_am) : fmtDate(w.erstellt_am)} />
            ))}
          </Gruppe>
        )}

        {anrufen > 0 && (
          <Gruppe icon={Phone} titel="Termine & Rückrufe" anzahl={anrufen}>
            {daten.termine.map((l) => (
              <Zeile key={'t' + l.id} to={`/crm?lead=${l.id}`} titel={name(l)} detail="Termin" rechts={uhr(l.meeting_date!)} />
            ))}
            {daten.rueckrufe.map((l) => {
              const tage = tageZwischen(tagVon(new Date(l.callback_date!)), heute);
              return <Zeile key={'r' + l.id} to={`/crm?lead=${l.id}`} titel={name(l)}
                detail={`Rückruf${l.callback_comment ? ` · ${einSatz(l.callback_comment, 120)}` : ''}`}
                rechts={tage > 0 ? `seit ${tage} Tg.` : 'heute'} warn={tage > 0} />;
            })}
          </Gruppe>
        )}

        {geld > 0 && (
          <Gruppe icon={Wallet} titel="Geld" anzahl={geld}>
            {daten.vertraege.map((c) => (
              <Zeile key={c.id} to={`/vertrag/${c.id}`} titel={c.party_company || c.party_name || '—'} detail={`Vertrag ${c.number ?? ''} unterschrieben – ansehen`} />
            ))}
            {overdue.map((r) => {
              const mahn = daten.mahnungen[r.id];
              const tage = r.due_date ? tageZwischen(r.due_date, heute) : 0;
              return <Zeile key={r.id} to={`/mahnwesen?beleg=${r.id}`} warn
                titel={r.recipient_company || r.recipient_name || '—'}
                detail={`Rechnung ${r.number ?? ''} überfällig${mahn ? ` · ${mahn.stufe === 1 ? 'Zahlungserinnerung' : `${mahn.stufe - 1}. Mahnung`} vom ${fmtDate(mahn.datum)}${mahn.frist ? `, Frist ${mahn.frist < heute ? 'abgelaufen' : mahn.frist === heute ? 'heute' : fmtDate(mahn.frist)}` : ''}` : ' – erinnern'}`}
                rechts={<>{eur(Math.max(0, Number(r.gross) - Number(r.paid_amount || 0)))}<br />{tage} Tg.</>} />;
            })}
            {restFaellig.map((x) => (
              <Zeile key={x.projektId} to={`/beleg/${x.letzteId}`} titel={x.kunde}
                detail={`Restrechnung fällig seit ${fmtDate(x.restFaelligAm)} – abrechnen`} rechts={`${eur(x.offen)} netto`} />
            ))}
            {entwuerfe.map((r) => (
              <Zeile key={r.id} to={`/beleg/${r.id}`} titel={r.recipient_company || r.recipient_name || '—'}
                detail={`Rechnung ${r.number ?? ''} ist noch Entwurf – verschicken${r.due_date ? ` (fällig ${fmtDate(r.due_date)})` : ''}`}
                rechts={eur(Number(r.gross))} />
            ))}
            {daten.angebote.map((o) => (
              <Zeile key={o.id} to={`/beleg/${o.id}`} titel={o.recipient_company || o.recipient_name || '—'}
                detail={`Angebot ${o.number ?? ''} vom ${fmtDate(o.doc_date)} – nachfassen`}
                rechts={<>{eur(Number(o.net))}<br />{tageZwischen(o.doc_date, heute)} Tg.</>} />
            ))}
          </Gruppe>
        )}

        {besprechungen.length > 0 && (
          <Gruppe icon={Mic} titel="Besprechungen" anzahl={besprechungen.length}>
            {besprechungen.map((b) => {
              const punkte = meinePunkte(b);
              const zuordnen = b.status === 'unklar';
              return <Zeile key={b.id} to="/besprechungen" titel={besprechungTitel(b.titel)}
                detail={zuordnen
                  ? `Noch keinem Kunden zugeordnet${punkte.length ? ` · ${punkte.length} Punkt${punkte.length > 1 ? 'e' : ''} für dich` : ''}`
                  : `${punkte.length} Punkt${punkte.length > 1 ? 'e' : ''} für dich: ${einSatz(punkte[0], 120)}`}
                rechts={b.beginn ? fmtDate(b.beginn) : undefined} />;
            })}
          </Gruppe>
        )}

        {daten.fehler && <p className="text-xs text-muted-foreground px-1">Nicht alles konnte geladen werden – Seite neu laden.</p>}
      </main>
    </div>
  );
}
