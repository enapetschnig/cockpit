/**
 * Der Änderungswunsch-Roboter (läuft am PC) legt hier seine Vorschläge ab –
 * Christoph gibt frei, ändert, lehnt ab und schaltet nach der Vorschau live.
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
  sitzungen?: string[];
  erstellt_am: string;
  aktualisiert: string;
}

const STATUS: Record<string, { label: string; cls: string; arbeitet?: boolean }> = {
  analyse:     { label: 'Roboter analysiert …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  vorschlag:   { label: 'Vorschlag zur Freigabe', cls: 'bg-amber-100 text-amber-800 border-amber-300 font-bold' },
  aendern:     { label: 'Roboter überarbeitet …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  freigegeben: { label: 'Freigegeben – startet gleich', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  in_arbeit:   { label: 'Roboter setzt um …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  vorschau:    { label: 'Vorschau bereit', cls: 'bg-amber-100 text-amber-800 border-amber-300 font-bold' },
  live:        { label: 'Wird live geschaltet …', cls: 'bg-blue-50 text-blue-700 border-blue-200', arbeitet: true },
  erledigt:    { label: '✓ Live', cls: 'bg-green-100 text-green-800 border-green-300' },
  abgelehnt:   { label: 'Abgelehnt', cls: 'bg-muted text-muted-foreground border-border' },
  verworfen:   { label: 'Verworfen', cls: 'bg-muted text-muted-foreground border-border' },
  wartet:      { label: 'Wartet auf dich', cls: 'bg-red-50 text-red-700 border-red-200' },
  fehler:      { label: 'Fehler', cls: 'bg-red-50 text-red-700 border-red-200' },
};
const AKTIV = ['analyse', 'vorschlag', 'aendern', 'freigegeben', 'in_arbeit', 'vorschau', 'live', 'wartet', 'fehler'];

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

/** Knopf an einem einzelnen Wunsch: an den Roboter geben – oder zeigen, wo er gerade steht. */
export function RoboterKnopf({ wunsch, auftraege, onNeu }: {
  wunsch: { id: string; app_key: string };
  auftraege: RoboterAuftrag[];
  onNeu: () => void;
}) {
  // Verworfene oder abgelehnte Aufträge sperren nicht – der Wunsch kann erneut an den Roboter.
  const a = auftraege.find((x) => x.wunsch_ids.includes(wunsch.id) && x.status !== 'verworfen' && x.status !== 'abgelehnt');
  if (a) {
    const st = STATUS[a.status] ?? { label: a.status, cls: '' };
    return (
      <a href={`#a-${a.id}`} className={'text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ' + st.cls}>
        <Bot className="w-3 h-3" /> {st.label}
      </a>
    );
  }
  const geben = async () => {
    const { error } = await db.from('roboter_auftraege').insert({ app_key: wunsch.app_key, wunsch_ids: [wunsch.id], status: 'analyse' });
    if (error) return toast.error('Konnte nicht an den Roboter übergeben werden');
    toast.success('Übergeben – der Vorschlag kommt in ein paar Minuten');
    onNeu();
  };
  return (
    <Button size="sm" variant="outline" className="gap-1" onClick={geben}>
      <Bot className="w-3.5 h-3.5" /> Vorschlag vom Roboter
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

  const setze = async (a: RoboterAuftrag, felder: Partial<RoboterAuftrag> & Record<string, unknown>, ok: string) => {
    const { error } = await db.from('roboter_auftraege').update({ ...felder, aktualisiert: new Date().toISOString() }).eq('id', a.id);
    if (error) return toast.error('Konnte nicht gespeichert werden');
    toast.success(ok);
    setAendernOffen(null);
    laden();
  };
  const antwortSpeichern = (a: RoboterAuftrag) => {
    const t = antwort[a.id];
    if (t === undefined || t === (a.antwort_kunde || '')) return;
    db.from('roboter_auftraege').update({ antwort_kunde: t }).eq('id', a.id).then(() => laden());
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
        // Dort weitermachen, wo es hakte: vor dem Vorschlag, beim Umsetzen oder beim Live-Schalten (dann wieder erst Vorschau).
        const nochmal = !a.vorschlag ? 'analyse' : !a.vorschau_url ? 'freigegeben' : 'vorschau';
        return (
          <Card key={a.id} id={`a-${a.id}`} className="p-4 mb-3 scroll-mt-20 border-l-4 border-l-amber-400">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <strong>{APP_LABEL[a.app_key] ?? a.app_key}</strong>
              <span className={'text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ' + st.cls}>
                {st.arbeitet && <Loader2 className="w-3 h-3 animate-spin" />}{st.label}
              </span>
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
            {a.protokoll && (a.status === 'vorschau' || a.status === 'erledigt') && (
              <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap mb-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">Umgesetzt</div>
                {a.protokoll}
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
                    onClick={() => setze(a, { status: 'aendern', anmerkung: anmerkung[a.id].trim() }, 'Der Roboter überarbeitet es')}>Absenden</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAendernOffen(null)}>Abbrechen</Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {a.status === 'vorschlag' && aendernOffen !== a.id && (
                <>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700"
                    onClick={() => { antwortSpeichern(a); setze(a, { status: 'freigegeben', freigegeben_am: new Date().toISOString() }, 'Freigegeben – der Roboter setzt es um'); }}>
                    Freigeben
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
                    onClick={() => { antwortSpeichern(a); if (confirm('Live schalten? Die Änderung geht an den Kunden raus, und er bekommt deine Antwort.')) setze(a, { status: 'live' }, 'Wird live geschaltet'); }}>
                    Live schalten
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAendernOffen(a.id)}>Ändern</Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground"
                    onClick={() => confirm('Umsetzung verwerfen? Der Zweig bleibt auf GitHub, live geht nichts.') && setze(a, { status: 'verworfen' }, 'Verworfen')}>Verwerfen</Button>
                </>
              )}
              {(a.status === 'fehler' || a.status === 'wartet') && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setze(a, { status: nochmal, fehler: null }, 'Der Roboter versucht es erneut')}>Nochmal versuchen</Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setze(a, { status: 'verworfen' }, 'Verworfen')}>Verwerfen</Button>
                </>
              )}
              {a.zweig && <span className="text-[11px] text-muted-foreground self-center">Zweig {a.zweig}</span>}
            </div>
            {/* Der ganze Verlauf liegt am PC im Projektordner – in VS Code fortsetzbar */}
            {!!a.sitzungen?.length && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Verlauf: {a.sitzungen.length} Claude-Sitzung{a.sitzungen.length > 1 ? 'en' : ''} – in VS Code (verbunden mit epower-pc) den Ordner öffnen → Claude → Sitzungen,
                oder im Terminal <span className="font-mono select-all">claude --resume {a.sitzungen[a.sitzungen.length - 1]}</span>
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
