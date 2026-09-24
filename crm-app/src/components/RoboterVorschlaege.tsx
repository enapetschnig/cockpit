/**
 * Der Änderungswunsch-Roboter (läuft am PC) legt hier seine Vorschläge ab –
 * ein gemeinsamer Vorschlag je Kunde. Christoph gibt frei, ändert oder lehnt ab;
 * nach der Freigabe setzt der Roboter um, prüft den Build und schaltet selbst live.
 * Der Roboter liest den Status alle 60 s und macht weiter; hier wird nur
 * der Status gesetzt (Tabelle crm.roboter_auftraege).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { APP_LABEL } from '@/lib/apps';
import { Bot, ExternalLink, Loader2 } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface RoboterAuftrag {
  id: string;
  app_key: string;
  wunsch_ids: string[];
  status: string;
  vorschlag: string | null;
  aufwand: string | null;
  risiko: string | null;
  datenbank: boolean;
  antwort_kunde: string | null;
  anmerkung: string | null;
  zweig: string | null;
  vorschau_url: string | null;
  fehler: string | null;
  protokoll: string | null;
  db_info?: string | null;
  db_hash?: string | null;
  yolo?: boolean;
  freigegeben_am?: string | null;
  sitzungen?: string[];
  geprueft?: string | null;         // fertig umgesetzt und geprüft (Zweig-Stand) – „Passt“ schaltet genau das live
  vor_kunde?: string | null;        // was vor der Antwort an den Kunden noch nötig ist (nur Christoph kann es)
  vor_kunde_ok_am?: string | null;  // Christophs OK zu genau dieser Liste
  erstellt_am: string;
  aktualisiert: string;
}

/** Live, aber der Kunde wartet noch auf Christophs OK (Roboter 2.8) – „Nochmal versuchen“ zählt hier nicht. */
const vorDemKunden = (a: RoboterAuftrag) =>
  a.status === 'wartet' && !!a.vor_kunde && !a.vor_kunde_ok_am && (a.fehler ?? '').startsWith('🧾 Vor dem Kunden');

const STATUS: Record<string, { label: string; cls: string; arbeitet?: boolean }> = {
  analyse:     { label: 'Roboter analysiert …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  vorbereiten: { label: 'Roboter setzt um und prüft – die fertige Lösung kommt gleich', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  vorschlag:   { label: 'Vorschlag zur Freigabe', cls: 'bg-amber-100 text-amber-800 border-amber-300 font-bold' },
  aendern:     { label: 'Roboter überarbeitet …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  freigegeben: { label: 'Freigegeben – startet gleich', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  in_arbeit:   { label: 'Roboter setzt um und schaltet live …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  // nur noch bei älteren Aufträgen (vor Roboter 2.0 gab es eine Vorschau vor dem Live-Schalten)
  vorschau:    { label: 'Vorschau bereit', cls: 'bg-amber-100 text-amber-800 border-amber-300 font-bold' },
  live:        { label: 'Wird live geschaltet …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  erledigt:    { label: '✓ Live', cls: 'bg-green-100 text-green-800 border-green-300' },
  abgelehnt:   { label: 'Abgelehnt', cls: 'bg-muted text-muted-foreground border-border' },
  verworfen:   { label: 'Verworfen', cls: 'bg-muted text-muted-foreground border-border' },
  wartet:      { label: 'Wartet auf dich', cls: 'bg-red-50 text-red-700 border-red-200' },
  fehler:      { label: 'Fehler', cls: 'bg-red-50 text-red-700 border-red-200' },
  db_pruefen:  { label: 'Prüft & spielt Datenbank ein …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  db_freigabe: { label: 'Datenbank-Änderung braucht dein OK', cls: 'bg-amber-100 text-amber-800 border-amber-300 font-bold' },
  db_live:     { label: 'Spielt Datenbank ein und schaltet live …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
};
const AKTIV = ['analyse', 'vorbereiten', 'vorschlag', 'aendern', 'freigegeben', 'in_arbeit', 'vorschau', 'live', 'wartet', 'fehler', 'db_pruefen', 'db_freigabe', 'db_live'];
const OFFEN_FUER_NEUE = ['analyse', 'vorbereiten', 'vorschlag', 'aendern'];
// Hier läuft ein YOLO-Auftrag ohne Freigabe – „Stopp“ hält ihn vor Datenbank und Live an.
const STOPPBAR = ['freigegeben', 'in_arbeit', 'db_pruefen', 'db_live'];
/** Postgres-Array-Literal für Filter ({"a","b"}). */
const pgArray = (ids: string[]) => `{${ids.map((i) => `"${i.replace(/["\\]/g, '\\$&')}"`).join(',')}}`;

/** Aufträge + Lebenszeichen, alle 20 s aktualisiert. */
export function useRoboter() {
  const [auftraege, setAuftraege] = useState<RoboterAuftrag[]>([]);
  const [puls, setPuls] = useState<{ zuletzt: string | null; meldung: string | null } | null>(null);
  const laden = useCallback(async () => {
    const seit = new Date(Date.now() - 3 * 86400_000).toISOString();
    const [{ data: a }, { data: p }] = await Promise.all([
      db.from('roboter_auftraege').select('*')
        .or(`status.in.(${AKTIV.join(',')}),aktualisiert.gte.${seit}`)
        .order('erstellt_am', { ascending: false }).limit(50),
      db.from('roboter_puls').select('zuletzt,meldung').eq('id', 1).maybeSingle(),
    ]);
    setAuftraege((a as RoboterAuftrag[]) || []);
    setPuls(p || null);
  }, []);
  useEffect(() => { laden(); const t = setInterval(laden, 20_000); return () => clearInterval(t); }, [laden]);
  return { auftraege, puls, laden };
}

// Verworfene oder abgelehnte Aufträge sperren nicht – der Wunsch kann erneut an den Roboter.
const zaehlt = (x: RoboterAuftrag) => x.status !== 'verworfen' && x.status !== 'abgelehnt';

/**
 * Knopf an einem einzelnen Wunsch: an den Roboter geben – oder zeigen, wo er gerade steht.
 * Alle offenen Wünsche desselben Kunden gehen gemeinsam mit; läuft für den Kunden schon
 * ein Vorschlag (noch nicht freigegeben), kommen sie dort dazu → ein gemeinsamer Vorschlag.
 */
export function RoboterKnopf({ wunsch, offeneIds, auftraege, onNeu, yoloSeit, erstelltAm }: {
  wunsch: { id: string; app_key: string };
  offeneIds: string[];
  auftraege: RoboterAuftrag[];
  onNeu: () => void;
  /** YOLO an seit (roboter_apps.aktualisiert) – undefined = aus */
  yoloSeit?: string;
  erstelltAm: Record<string, string>;
}) {
  const a = auftraege.find((x) => x.wunsch_ids.includes(wunsch.id) && zaehlt(x));
  if (a) {
    const st = (a.status === 'in_arbeit' && !a.freigegeben_am && !a.yolo ? STATUS.vorbereiten : STATUS[a.status]) ?? { label: a.status, cls: '' };
    return (
      <a href={`#a-${a.id}`} className={'text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ' + st.cls}>
        <Bot className="w-3 h-3" /> {st.label}
      </a>
    );
  }
  const frei = [...new Set([wunsch.id, ...offeneIds])]
    .filter((id) => !auftraege.some((x) => zaehlt(x) && x.wunsch_ids.includes(id)));
  const offenerVorschlag = auftraege.find((x) => x.app_key === wunsch.app_key && OFFEN_FUER_NEUE.includes(x.status));
  // YOLO an → alles geht ohne Freigabe live (auch ältere Wünsche).
  const alle = [...(offenerVorschlag?.wunsch_ids ?? []), ...frei];
  const direkt = !!yoloSeit && alle.length > 0;
  const geben = async () => {
    if (direkt && !confirm('YOLO ist an: Der Roboter setzt das OHNE deine Freigabe um und schaltet live. Weiter?')) return;
    if (offenerVorschlag) {
      // Nur solange der Vorschlag noch offen ist und niemand inzwischen Wünsche angehängt hat.
      const { data, error } = await db.from('roboter_auftraege').update({
        // neue Wünsche → neu analysieren, umsetzen und prüfen; die bisher geprüfte Lösung gilt nicht mehr
        wunsch_ids: [...offenerVorschlag.wunsch_ids, ...frei], status: 'analyse', freigegeben_am: null, gemeldet: null, geprueft: null,
        versuche: 0, naechster_versuch: null,
        aktualisiert: new Date().toISOString(),
      }).eq('id', offenerVorschlag.id).in('status', OFFEN_FUER_NEUE)
        .contains('wunsch_ids', pgArray(offenerVorschlag.wunsch_ids)).containedBy('wunsch_ids', pgArray(offenerVorschlag.wunsch_ids))
        .select('id');
      if (error) return toast.error('Konnte nicht an den Roboter übergeben werden');
      if (!data?.length) { toast.error('Der Stand hat sich geändert – neu geladen, bitte nochmal'); return onNeu(); }
    } else {
      // Frisch nachsehen: hat der Roboter die Wünsche inzwischen selbst gesammelt? Sonst stecken sie in zwei Aufträgen.
      const { data: schon } = await db.from('roboter_auftraege').select('id')
        .overlaps('wunsch_ids', pgArray(frei)).not('status', 'in', '(verworfen,abgelehnt)').limit(1);
      if (schon?.length) { toast.error('Der Roboter hat die Wünsche inzwischen selbst übernommen – neu geladen'); return onNeu(); }
      const { error } = await db.from('roboter_auftraege').insert({ app_key: wunsch.app_key, wunsch_ids: frei, status: 'analyse' });
      if (error) return toast.error('Konnte nicht an den Roboter übergeben werden');
    }
    toast.success(direkt
      ? '⚡ YOLO: Der Roboter setzt es ohne Freigabe um und schaltet live'
      : offenerVorschlag
        ? 'Zum offenen Vorschlag dazugegeben – der Roboter fasst alles neu zusammen'
        : 'Übergeben – der Vorschlag kommt in ein paar Minuten');
    onNeu();
  };
  return (
    <Button size="sm" variant="outline" className="gap-1" onClick={geben}
      title={direkt ? 'YOLO: ohne Freigabe umsetzen und live schalten' : undefined}>
      <Bot className="w-3.5 h-3.5" />
      {direkt ? '⚡ Umsetzen (YOLO)' : offenerVorschlag ? 'Zum Roboter-Vorschlag dazu' : 'Vorschlag vom Roboter'}
      {frei.length > 1 && ` (${frei.length} Wünsche)`}
    </Button>
  );
}

/** Die Vorschläge oben auf der Wünsche-Seite. */
export function RoboterVorschlaege({ auftraege, puls, laden, texte }: {
  auftraege: RoboterAuftrag[];
  puls: { zuletzt: string | null; meldung: string | null } | null;
  laden: () => void;
  texte: Record<string, { text: string; melder: string | null }>;
}) {
  const [anmerkung, setAnmerkung] = useState<Record<string, string>>({});
  const [aendernOffen, setAendernOffen] = useState<string | null>(null);
  const [antwort, setAntwort] = useState<Record<string, string>>({});

  // Link aus Telegram (#a-<id>) → hinscrollen
  useEffect(() => {
    const h = window.location.hash;
    if (h.startsWith('#a-')) setTimeout(() => document.getElementById(h.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }, [auftraege.length]);

  /**
   * Status nur ändern, wenn der Auftrag noch so steht wie angezeigt (die Liste kann 20 s alt sein,
   * confirm() hält beliebig lange). gemeldet zurück, damit Telegram die nächste Stufe wieder meldet.
   */
  const setze = async (a: RoboterAuftrag, felder: Record<string, unknown>, ok: string,
    opt: { von?: string[]; nurWenn?: Record<string, unknown> } = {}) => {
    let q = db.from('roboter_auftraege').update({ ...felder, gemeldet: null, aktualisiert: new Date().toISOString() })
      .eq('id', a.id).in('status', opt.von ?? [a.status]);
    for (const [k, v] of Object.entries(opt.nurWenn ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v);
    const { data, error } = await q.select('id');
    if (error) return toast.error('Konnte nicht gespeichert werden');
    if (!data?.length) { toast.error('Der Stand hat sich geändert – neu geladen'); return laden(); }
    toast.success(ok);
    setAendernOffen(null);
    laden();
  };
  const antwortFeld = (a: RoboterAuftrag) => {
    const t = antwort[a.id];
    return t !== undefined && t !== (a.antwort_kunde || '') ? { antwort_kunde: t } : {};
  };
  const antwortSpeichern = (a: RoboterAuftrag) => {
    const f = antwortFeld(a);
    if (!('antwort_kunde' in f)) return;
    db.from('roboter_auftraege').update(f).eq('id', a.id).in('status', ['vorschlag', 'vorschau']).then(() => laden());
  };
  const freigeben = async (a: RoboterAuftrag) => {
    // Kam während der Rückfrage ein neuer Vorschlag, nicht den ungesehenen freigeben.
    const { data: jetzt } = await db.from('roboter_auftraege').select('vorschlag, geprueft').eq('id', a.id).maybeSingle();
    if ((jetzt?.vorschlag ?? null) !== (a.vorschlag ?? null) || (jetzt?.geprueft ?? null) !== (a.geprueft ?? null)) {
      toast.error('Inzwischen gibt es einen neuen Vorschlag – bitte nochmal ansehen');
      return laden();
    }
    // fehler leeren: ein alter Hinweis (z. B. „YOLO wurde ausgeschaltet“) käme sonst als „ging schief“ in den Umsetzen-Prompt.
    setze(a, { status: 'freigegeben', freigegeben_am: new Date().toISOString(), fehler: null, versuche: 0, naechster_versuch: null, wartet_seit: null,
      // „Passt“ bestätigt die Liste nur bei einer fertigen Lösung – nur dort wird sie gezeigt.
      ...(a.vor_kunde && a.geprueft ? { vor_kunde_ok_am: new Date().toISOString() } : {}), ...antwortFeld(a) },
      a.geprueft ? 'Passt – der Roboter schaltet es jetzt live' : 'Freigegeben – der Roboter setzt es um und schaltet live',
      { nurWenn: { geprueft: a.geprueft ?? null, db_hash: a.db_hash ?? null, vor_kunde: a.vor_kunde ?? null } });
  };

  const vorMin = puls?.zuletzt ? Math.round((Date.now() - new Date(puls.zuletzt).getTime()) / 60_000) : null;
  const laeuft = vorMin !== null && vorMin <= 3;
  // Oben nur, woran gerade gearbeitet wird oder was auf Christoph wartet – Fertiges steht im Verlauf beim Kunden.
  const sichtbar = auftraege.filter((a) => AKTIV.includes(a.status));

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <Bot className="w-4 h-4" />
        <h2 className="font-semibold">Roboter</h2>
        <span className={'text-xs ' + (laeuft ? 'text-green-700' : 'text-red-600')}>
          {laeuft ? `● läuft${puls?.meldung && puls.meldung !== 'bereit' ? ` – ${puls.meldung}` : ''}`
            : vorMin === null ? '○ noch nie gestartet' : `○ seit ${vorMin} Min. kein Lebenszeichen (PC aus?)`}
        </span>
      </div>
      {sichtbar.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Gerade läuft nichts. Neue Wünsche sammelt der Roboter 10 Minuten je Kunde (bei YOLO 2) und schreibt dann einen Vorschlag.
          Was er schon erledigt hat: Kunden anklicken → Verlauf.
        </p>
      )}
      {sichtbar.map((a) => {
        const st = (a.status === 'in_arbeit' && !a.freigegeben_am && !a.yolo ? STATUS.vorbereiten : STATUS[a.status]) ?? { label: a.status, cls: '' };
        // Umsetzen nur, wenn wirklich freigegeben wurde – sonst neu analysieren (ältere Aufträge: zurück zur Vorschau).
        // Vor der Freigabe gescheitert, aber schon analysiert → weiter umsetzen und prüfen (vorbereiten).
        const nochmal = a.vorschau_url ? 'vorschau' : a.freigegeben_am ? 'freigegeben' : a.vorschlag ? 'vorbereiten' : 'analyse';
        const fertig = a.status === 'vorschlag' && !!a.geprueft;   // fertig umgesetzt und geprüft – wartet auf „Passt“
        // Nur Altaufträge (2.1): umgesetzt, Datenbank sollte von Hand eingespielt werden.
        const handarbeit = a.status === 'wartet' && a.datenbank && !!a.zweig && /bewusst nicht selbst ein/.test(a.fehler ?? '');
        const kunde = APP_LABEL[a.app_key] ?? a.app_key;
        return (
          <Card key={a.id} id={`a-${a.id}`} className="p-4 mb-3 scroll-mt-20 border-l-4 border-l-amber-400">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <strong>{kunde}</strong>
              <span className={'text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ' + st.cls}>
                {st.arbeitet && <Loader2 className="w-3 h-3 animate-spin" />}{st.label}
              </span>
              {a.yolo && <span className="text-xs text-amber-700 font-semibold">⚡ YOLO</span>}
              {a.aufwand && <span className="text-xs text-muted-foreground">Aufwand {a.aufwand}</span>}
              {a.risiko && <span className="text-xs text-muted-foreground">· Risiko {a.risiko}</span>}
              {a.datenbank && <span className="text-xs text-red-700 font-medium">· braucht Datenbank-Änderung</span>}
            </div>

            <ol className="text-sm text-muted-foreground list-decimal pl-5 mb-2 space-y-0.5">
              {a.wunsch_ids.map((id) => (
                <li key={id}>„{texte[id]?.text ?? '…'}“{texte[id]?.melder ? ` – ${texte[id].melder}` : ''}</li>
              ))}
            </ol>

            {a.vorschlag && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap mb-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">{fertig ? 'Plan' : 'Vorschlag'}</div>
                {a.vorschlag}
              </div>
            )}
            {a.protokoll && (fertig || ['vorschau', 'erledigt', 'wartet', 'fehler', 'db_freigabe'].includes(a.status)) && (
              <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap mb-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">{fertig ? 'So habe ich es gelöst (fertig und geprüft)' : 'Umgesetzt'}</div>
                {a.protokoll}
              </div>
            )}
            {fertig && a.vor_kunde && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm whitespace-pre-wrap mb-2">
                <div className="text-xs font-semibold text-amber-800 mb-1">🧾 Dafür brauche ich noch von dir – „Passt“ heißt: ist erledigt (oder geht ohne)</div>
                {a.vor_kunde}
              </div>
            )}
            {a.db_info && (
              <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap mb-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">
                  Datenbank{a.status === 'db_freigabe' ? ' – das würde sich ändern' : ''}
                </div>
                {a.db_info}
              </div>
            )}
            {a.fehler && <div className="rounded-lg bg-red-50 text-red-800 p-3 text-sm mb-2 whitespace-pre-wrap">{a.fehler}</div>}

            {(a.status === 'vorschlag' || a.status === 'vorschau') && (
              <div className="mb-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">Antwort an den Kunden (sieht er nach „live“ in seiner App)</div>
                <Textarea rows={2} value={antwort[a.id] ?? a.antwort_kunde ?? ''}
                  onChange={(e) => setAntwort((x) => ({ ...x, [a.id]: e.target.value }))} onBlur={() => antwortSpeichern(a)} />
              </div>
            )}

            {a.status === 'vorschau' && a.vorschau_url && (
              <a href={a.vorschau_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline mb-2">
                <ExternalLink className="w-3.5 h-3.5" /> Vorschau öffnen
              </a>
            )}

            {aendernOffen === a.id && (
              <div className="mb-2">
                <Textarea rows={2} autoFocus placeholder="Was soll anders sein? z. B. „nur bei Fotos, nicht bei Plänen“"
                  value={anmerkung[a.id] ?? ''} onChange={(e) => setAnmerkung((x) => ({ ...x, [a.id]: e.target.value }))} />
                <div className="flex gap-2 mt-1.5">
                  <Button size="sm" disabled={!anmerkung[a.id]?.trim()}
                    onClick={() => setze(a, {
                      status: 'aendern', anmerkung: anmerkung[a.id].trim(), geprueft: null, versuche: 0,
                      // überarbeiteter Vorschlag muss neu freigegeben werden
                      ...(a.status === 'vorschlag' ? { freigegeben_am: null } : {}),
                    }, 'Der Roboter überarbeitet es')}>Absenden</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAendernOffen(null)}>Abbrechen</Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {a.status === 'vorschlag' && aendernOffen !== a.id && (
                <>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      antwortSpeichern(a);
                      const frage = fertig
                        ? 'Passt – live schalten? Die Lösung ist fertig und geprüft. Der Roboter spielt die Datenbank-Änderung ein (wie oben), schaltet live und schickt dem Kunden deine Antwort, sobald alles wirklich läuft.'
                        : 'Freigeben & live schalten? Der Roboter setzt es um, prüft selbst (Build, Tests, Durchsicht) und schaltet live – der Kunde bekommt deine Antwort.'
                          + (a.datenbank ? ' Neue Tabellen/Spalten spielt er selbst ein; verändert die Datenbank-Änderung Bestehendes, fragt er vorher noch einmal.' : '');
                      if (confirm(frage)) freigeben(a);
                    }}>
                    {fertig ? '✅ Passt – live schalten' : 'Freigeben & live schalten'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAendernOffen(a.id)}>Ändern</Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground"
                    onClick={() => confirm('Vorschlag ablehnen? Am Code ändert sich nichts.') && setze(a, { status: 'abgelehnt' }, 'Abgelehnt')}>Ablehnen</Button>
                </>
              )}
              {a.status === 'vorschau' && aendernOffen !== a.id && (
                <>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={a.datenbank}
                    title={a.datenbank ? 'Datenbank-Änderung – bitte in VS Code mit Claude live schalten' : undefined}
                    onClick={() => { antwortSpeichern(a); if (confirm('Live schalten? Die Änderung geht an den Kunden raus, und er bekommt deine Antwort.')) setze(a, { status: 'live', ...antwortFeld(a) }, 'Wird live geschaltet'); }}>
                    Live schalten
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAendernOffen(a.id)}>Ändern</Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground"
                    onClick={() => confirm('Umsetzung verwerfen? Der Zweig bleibt auf GitHub, live geht nichts.') && setze(a, { status: 'verworfen' }, 'Verworfen')}>Verwerfen</Button>
                </>
              )}
              {a.status === 'db_freigabe' && (
                <Button size="sm" className="bg-green-600 hover:bg-green-700"
                  onClick={() => confirm('Datenbank-Änderung einspielen & live schalten? Tabellen, deren Daten verloren gehen könnten, sichert der Roboter vorher.'
                    + (/vorhandene Migrationsdatei/i.test(a.db_info ?? '') ? ' Geänderte alte Migrationsdateien spielt er nicht ein – dafür geht nur der Code live.' : ''))
                    // OK gilt nur für den gezeigten Datenbank-Stand
                    && setze(a, { status: 'db_live' }, 'Der Roboter spielt ein und schaltet live', { nurWenn: { db_hash: a.db_hash ?? null } })}>
                  Einspielen & live schalten
                </Button>
              )}
              {handarbeit && (
                <Button size="sm" className="bg-green-600 hover:bg-green-700"
                  onClick={() => confirm('Datenbank einspielen & live schalten? Der Roboter prüft vorher selbst (Build, Tests, Durchsicht); verändert die Änderung Bestehendes, fragt er noch einmal.')
                    && setze(a, { status: 'db_pruefen', fehler: null }, 'Der Roboter prüft, spielt die Datenbank ein und schaltet live')}>
                  Datenbank einspielen & live schalten
                </Button>
              )}
              {STOPPBAR.includes(a.status) && (a.yolo || !!a.freigegeben_am) && (
                <Button size="sm" variant="outline" className="text-red-700"
                  onClick={() => confirm('Auftrag stoppen? Es geht nichts live; schon Umgesetztes bleibt nur im Zweig.')
                    && setze(a, { status: 'verworfen' }, 'Gestoppt – es geht nichts live', { von: STOPPBAR })}>
                  ⏹ Stopp
                </Button>
              )}
              {a.status === 'db_freigabe' && (
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setze(a, { status: 'verworfen' }, 'Verworfen')}>Verwerfen</Button>
              )}
              {(a.status === 'fehler' || a.status === 'wartet') && (
                <>
                  {/* Live, aber vor der Antwort an den Kunden fehlte noch etwas, das nur Christoph kann – sein OK zu genau dieser Liste */}
                  {!handarbeit && (vorDemKunden(a)
                    ? <Button size="sm" onClick={() => confirm(`Erledigt?\n\n${a.vor_kunde}\n\nDer Roboter prüft dann den Live-Stand nochmal und schickt dem Kunden erst danach die Antwort.`)
                        && setze(a, { status: 'live', vor_kunde_ok_am: new Date().toISOString() },
                          'Der Kunde bekommt die Antwort, sobald der Roboter den Live-Stand geprüft hat',
                          { von: ['wartet'], nurWenn: { vor_kunde: a.vor_kunde ?? null, vor_kunde_ok_am: null } })}>
                        ✅ Erledigt – Kunde bekommt Bescheid
                      </Button>
                    : <Button size="sm" variant="outline" onClick={() => setze(a, { status: nochmal, versuche: 0, naechster_versuch: null, wartet_seit: null }, 'Der Roboter versucht es erneut')}>Nochmal versuchen</Button>)}
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setze(a, { status: 'verworfen' }, 'Verworfen')}>Verwerfen</Button>
                </>
              )}
              {a.zweig && <span className="text-[11px] text-muted-foreground self-center">Zweig {a.zweig}</span>}
            </div>
            {/* Ein Claude-Verlauf je Kunde am PC – Roboter und Christoph schreiben in denselben */}
            {!!a.sitzungen?.length && (
              <p className="text-[11px] text-muted-foreground mt-2" title={`Sitzungen: ${a.sitzungen.join(', ')}`}>
                Verlauf: VS Code (epower-pc) → Projektordner des Kunden → Claude → „Roboter · {kunde}“
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

const FERTIG: Record<string, string> = { erledigt: '✓ Live', abgelehnt: 'Abgelehnt', verworfen: 'Verworfen' };
const kuerzen = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Was der Roboter bei einem Kunden schon erledigt (oder verworfen) hat – kompakt, zum Aufklappen. */
export function RoboterVerlauf({ appKey }: { appKey: string }) {
  const [liste, setListe] = useState<RoboterAuftrag[] | null>(null);
  const [texte, setTexte] = useState<Record<string, { text: string; melder: string | null }>>({});
  useEffect(() => {
    let aktiv = true;
    (async () => {
      const { data } = await db.from('roboter_auftraege').select('*').eq('app_key', appKey)
        .in('status', Object.keys(FERTIG)).order('aktualisiert', { ascending: false }).limit(30);
      const auftraege = (data as RoboterAuftrag[]) || [];
      const ids = [...new Set(auftraege.flatMap((a) => a.wunsch_ids))];
      const { data: ws } = ids.length
        ? await db.from('app_wuensche').select('id, text, melder').in('id', ids)
        : { data: [] };
      if (!aktiv) return;
      setTexte(Object.fromEntries(((ws || []) as { id: string; text: string; melder: string | null }[]).map((w) => [w.id, { text: w.text, melder: w.melder }])));
      setListe(auftraege);
    })();
    return () => { aktiv = false; };
  }, [appKey]);

  if (!liste?.length) return null;
  const kunde = APP_LABEL[appKey] ?? appKey;
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-baseline gap-x-2 mb-1.5">
        <h3 className="text-sm font-semibold">Verlauf beim Roboter</h3>
        <span className="text-[11px] text-muted-foreground">
          {liste.length} erledigt · ganzer Verlauf: VS Code (epower-pc) → Projektordner → Claude → „Roboter · {kunde}“
        </span>
      </div>
      <div className="rounded-xl border divide-y bg-card">
        {liste.map((a) => {
          const erster = texte[a.wunsch_ids[0]]?.text ?? a.anmerkung ?? '';
          return (
            <details key={a.id} className="group px-3 py-2 text-sm">
              <summary className="cursor-pointer list-none flex items-baseline gap-2">
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {new Date(a.aktualisiert).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}
                </span>
                <span className={'text-[11px] shrink-0 ' + (a.status === 'erledigt' ? 'text-green-700 font-medium' : 'text-muted-foreground')}>
                  {FERTIG[a.status]}{a.yolo ? ' ⚡' : ''}
                </span>
                <span className="truncate">{kuerzen(erster.replace(/\s+/g, ' '), 110)}</span>
                {a.wunsch_ids.length > 1 && <span className="text-[11px] text-muted-foreground shrink-0">+{a.wunsch_ids.length - 1}</span>}
              </summary>
              <div className="mt-2 space-y-2 text-[13px]">
                <ol className="list-decimal pl-5 text-muted-foreground space-y-0.5">
                  {a.wunsch_ids.map((id) => (
                    <li key={id}>„{texte[id]?.text ?? '…'}“{texte[id]?.melder ? ` – ${texte[id].melder}` : ''}</li>
                  ))}
                </ol>
                {a.protokoll && <div className="whitespace-pre-wrap"><span className="font-semibold">Umgesetzt: </span>{a.protokoll}</div>}
                {a.db_info && <div className="whitespace-pre-wrap text-muted-foreground"><span className="font-semibold">Datenbank: </span>{a.db_info}</div>}
                {a.antwort_kunde && <div className="text-muted-foreground"><span className="font-semibold">Antwort an den Kunden: </span>{a.antwort_kunde}</div>}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
