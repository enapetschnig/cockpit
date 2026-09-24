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
  erstellt_am: string;
  aktualisiert: string;
}

const STATUS: Record<string, { label: string; cls: string; arbeitet?: boolean }> = {
  analyse:     { label: 'Roboter analysiert …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
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
const AKTIV = ['analyse', 'vorschlag', 'aendern', 'freigegeben', 'in_arbeit', 'vorschau', 'live', 'wartet', 'fehler', 'db_pruefen', 'db_freigabe', 'db_live'];
const OFFEN_FUER_NEUE = ['analyse', 'vorschlag', 'aendern'];
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
    const st = STATUS[a.status] ?? { label: a.status, cls: '' };
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
        wunsch_ids: [...offenerVorschlag.wunsch_ids, ...frei], status: 'analyse', freigegeben_am: null, gemeldet: null,
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
    const { data: jetzt } = await db.from('roboter_auftraege').select('vorschlag').eq('id', a.id).maybeSingle();
    if ((jetzt?.vorschlag ?? null) !== (a.vorschlag ?? null)) {
      toast.error('Inzwischen gibt es einen neuen Vorschlag – bitte nochmal ansehen');
      return laden();
    }
    // fehler leeren: ein alter Hinweis (z. B. „YOLO wurde ausgeschaltet“) käme sonst als „ging schief“ in den Umsetzen-Prompt.
    setze(a, { status: 'freigegeben', freigegeben_am: new Date().toISOString(), fehler: null, ...antwortFeld(a) }, 'Freigegeben – der Roboter setzt es um und schaltet live');
  };

  const vorMin = puls?.zuletzt ? Math.round((Date.now() - new Date(puls.zuletzt).getTime()) / 60_000) : null;
  const laeuft = vorMin !== null && vorMin <= 3;
  const sichtbar = auftraege.filter((a) => a.status !== 'abgelehnt' && a.status !== 'verworfen');

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
          Neue Wünsche sammelt der Roboter 10 Minuten je Kunde und schreibt dann einen Vorschlag. Ältere Wünsche: unten „Vorschlag vom Roboter“.
        </p>
      )}
      {sichtbar.map((a) => {
        const st = STATUS[a.status] ?? { label: a.status, cls: '' };
        // Umsetzen nur, wenn wirklich freigegeben wurde – sonst neu analysieren (ältere Aufträge: zurück zur Vorschau).
        const nochmal = a.vorschau_url ? 'vorschau' : a.freigegeben_am ? 'freigegeben' : 'analyse';
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
                <div className="text-xs font-semibold text-muted-foreground mb-1">Vorschlag</div>
                {a.vorschlag}
              </div>
            )}
            {a.protokoll && ['vorschau', 'erledigt', 'wartet', 'fehler', 'db_freigabe'].includes(a.status) && (
              <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap mb-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">Umgesetzt</div>
                {a.protokoll}
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
                      status: 'aendern', anmerkung: anmerkung[a.id].trim(),
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
                      const frage = 'Freigeben & live schalten? Der Roboter setzt es um, prüft selbst (Build, Tests, Durchsicht) und schaltet live – der Kunde bekommt deine Antwort.'
                        + (a.datenbank ? ' Neue Tabellen/Spalten spielt er selbst ein; verändert die Datenbank-Änderung Bestehendes, fragt er vorher noch einmal.' : '');
                      if (confirm(frage)) freigeben(a);
                    }}>
                    Freigeben & live schalten
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
              {a.yolo && STOPPBAR.includes(a.status) && (
                <Button size="sm" variant="outline" className="text-red-700"
                  onClick={() => confirm('YOLO-Auftrag stoppen? Es geht nichts live; schon Umgesetztes bleibt nur im Zweig.')
                    && setze(a, { status: 'verworfen' }, 'Gestoppt – es geht nichts live', { von: STOPPBAR, nurWenn: { yolo: true } })}>
                  ⏹ Stopp
                </Button>
              )}
              {a.status === 'db_freigabe' && (
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setze(a, { status: 'verworfen' }, 'Verworfen')}>Verwerfen</Button>
              )}
              {(a.status === 'fehler' || a.status === 'wartet') && (
                <>
                  {!handarbeit && <Button size="sm" variant="outline" onClick={() => setze(a, { status: nochmal }, 'Der Roboter versucht es erneut')}>Nochmal versuchen</Button>}
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
