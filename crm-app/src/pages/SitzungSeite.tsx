/**
 * Eine Claude-Sitzung als Chat am Handy: Verlauf (live gespiegelt vom Roboter), Schritte zusammengefasst,
 * unten schreiben. Solange die Seite offen ist, spiegelt der Roboter auch Sitzungen mit, die gerade in VS Code
 * oder von einem Roboter-Auftrag weiterlaufen (beobachten_bis).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppNav } from '@/components/AppNav';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { APP_LABEL } from '@/lib/apps';
import { HERKUNFT, SITZUNG_FELDER, bloecke, nachrichtSenden, uhrzeit, type Nachricht, type Sitzung } from '@/lib/sitzungen';
import { AlertTriangle, ArrowLeft, Clock, Loader2, Send, Square, Wrench } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function Schritte({ zeilen, offen }: { zeilen: Nachricht[]; offen: boolean }) {
  return (
    <details className="group text-xs text-muted-foreground" open={offen}>
      <summary className="cursor-pointer list-none flex items-center gap-1.5 py-1 select-none">
        <Wrench className="w-3 h-3 shrink-0" />
        <span className="shrink-0 whitespace-nowrap">{zeilen.length} {zeilen.length === 1 ? 'Schritt' : 'Schritte'}</span>
        <span className="min-w-0 truncate group-open:hidden">· {zeilen.at(-1)!.text}</span>
      </summary>
      <ul className="ml-4 border-l pl-3 space-y-0.5 pb-1">
        {zeilen.map((z) => <li key={z.id} className="break-words">{z.text}</li>)}
      </ul>
    </details>
  );
}

export default function SitzungSeite() {
  const { key = '', id = '' } = useParams();
  const [s, setS] = useState<Sitzung | null>(null);
  const [liste, setListe] = useState<Nachricht[]>([]);
  const [text, setText] = useState('');
  const [sendet, setSendet] = useState(false);
  const [fehlt, setFehlt] = useState(false);
  const letzte = useRef(0);
  const unten = useRef<HTMLDivElement>(null);
  const amEnde = useRef(true);

  const laden = useCallback(async () => {
    const [a, b] = await Promise.all([
      db.from('cockpit_sitzungen').select(SITZUNG_FELDER).eq('id', id).maybeSingle(),
      db.from('cockpit_nachrichten').select('id,rolle,text,status,erstellt_am').eq('sitzung_id', id)
        .gt('id', letzte.current).order('id', { ascending: true }).limit(500),
    ]);
    if (!a.data && !a.error) setFehlt(true);
    if (a.data) setS(a.data as Sitzung);
    const neu = (b.data || []) as Nachricht[];
    if (neu.length) {
      letzte.current = neu.at(-1)!.id;
      setListe((alt) => [...alt, ...neu]);
    }
  }, [id]);

  // Status meiner eigenen Nachrichten (gesendet → in Arbeit → erledigt) ändert sich nachträglich – die nachladen
  const eigeneNachladen = useCallback(async () => {
    const ids = liste.filter((n) => n.rolle === 'du' && (n.status === 'neu' || n.status === 'in_arbeit')).map((n) => n.id);
    if (!ids.length) return;
    const { data } = await db.from('cockpit_nachrichten').select('id,status').in('id', ids);
    const st = new Map(((data || []) as { id: number; status: Nachricht['status'] }[]).map((x) => [x.id, x.status]));
    setListe((alt) => alt.map((n) => (st.has(n.id) && st.get(n.id) !== n.status ? { ...n, status: st.get(n.id)! } : n)));
  }, [liste]);

  const offen = liste.some((n) => n.rolle === 'du' && (n.status === 'neu' || n.status === 'in_arbeit'));
  const arbeitet = s?.status === 'laeuft' || s?.status === 'wartet' || offen;

  useEffect(() => { laden(); }, [laden]);
  useEffect(() => {
    const t = setInterval(() => { laden(); eigeneNachladen(); }, arbeitet ? 2000 : 8000);
    return () => clearInterval(t);
  }, [laden, eigeneNachladen, arbeitet]);

  // Offen = der Roboter spiegelt auch, was in VS Code oder bei einem Auftrag in dieser Sitzung weiterläuft
  useEffect(() => {
    const melden = () => db.from('cockpit_sitzungen').update({ beobachten_bis: new Date(Date.now() + 3 * 60_000).toISOString() }).eq('id', id);
    melden();
    const t = setInterval(melden, 60_000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    const f = () => { amEnde.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160; };
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  useLayoutEffect(() => { if (amEnde.current) unten.current?.scrollIntoView({ block: 'end' }); }, [liste.length, s?.status]);

  const senden = async () => {
    const t = text.trim();
    if (!t || sendet) return;
    setSendet(true);
    try {
      await nachrichtSenden(id, t);
      setText('');
      amEnde.current = true;
      await laden();
    } catch {
      toast.error('Konnte nicht gesendet werden');
    } finally { setSendet(false); }
  };
  const abbrechen = async () => {
    if (!confirm('Claude jetzt anhalten? Was bis dahin geändert ist, bleibt ungespeichert in der Arbeitskopie.')) return;
    const { error } = await db.from('cockpit_sitzungen').update({ abbrechen: true }).eq('id', id);
    if (error) toast.error('Konnte nicht abgebrochen werden'); else toast.success('Wird angehalten …');
  };

  const herkunft = s ? HERKUNFT[s.herkunft] : null;
  const titel = s?.titel.replace(/^(Roboter|Cockpit) · [^·]+ · /, '') ?? '';
  const bl = bloecke(liste);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppNav />
      <div className="sticky top-[57px] z-20 bg-background/95 backdrop-blur border-b">
        <div className="max-w-3xl mx-auto px-2 py-2 flex items-center gap-1">
          <Link to={`/apps/${encodeURIComponent(key)}`} className="p-2 rounded-lg hover:bg-muted shrink-0" aria-label="Zurück zur App"><ArrowLeft className="w-5 h-5" /></Link>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{titel || '…'}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {APP_LABEL[key] ?? key}{herkunft && <> · {herkunft.label}</>}
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-3xl w-full mx-auto px-3 py-3 space-y-2">
        {fehlt && <p className="text-sm text-muted-foreground">Diese Sitzung gibt es nicht (mehr).</p>}
        {!fehlt && !liste.length && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {s?.herkunft === 'cockpit' || arbeitet ? 'Gleich geht es los …' : 'Verlauf wird geladen – der Roboter holt ihn in wenigen Sekunden von der Devbox.'}
          </p>
        )}
        {bl.map((b, i) => {
          if (b.art === 'schritte') return <Schritte key={`s${b.key}`} zeilen={b.zeilen} offen={arbeitet && i === bl.length - 1} />;
          const n = b.n;
          if (n.rolle === 'du') {
            return (
              <div key={n.id} className="flex flex-col items-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3.5 py-2 text-[15px] whitespace-pre-wrap break-words">{n.text}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 mr-1">
                  {uhrzeit(n.erstellt_am)}
                  {n.status === 'neu' && ' · gesendet'}
                  {n.status === 'in_arbeit' && ' · Claude liest'}
                  {n.status === 'fehler' && <span className="text-red-600"> · ging nicht</span>}
                </div>
              </div>
            );
          }
          if (n.rolle === 'info') {
            return <div key={n.id} className="text-center text-xs text-muted-foreground px-4 py-1 whitespace-pre-wrap break-words">{n.text}</div>;
          }
          return (
            <div key={n.id} className="max-w-[92%] rounded-2xl rounded-bl-md border bg-card px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
              {n.text}
            </div>
          );
        })}
        {arbeitet && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            {s?.status === 'wartet' ? <Clock className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span className="flex-1">{s?.hinweis || (s?.status === 'laeuft' ? 'Claude arbeitet …' : 'gesendet – der Roboter holt es in ein paar Sekunden ab')}</span>
            {s?.status === 'laeuft' && (
              <Button size="sm" variant="ghost" className="h-8 gap-1 text-red-700" onClick={abbrechen}><Square className="w-3 h-3" /> Abbrechen</Button>
            )}
          </div>
        )}
        {s?.status === 'fehler' && !arbeitet && (
          <div className="flex items-start gap-2 text-xs text-red-700 py-1"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {s.hinweis || 'Fehler'} – schreib einfach weiter, dann probiert Claude es nochmal.</div>
        )}
        <div ref={unten} />
      </main>

      <div className="sticky bottom-[var(--unten)] z-20 bg-background/95 backdrop-blur border-t">
        <div className="max-w-3xl mx-auto px-3 py-2">
          {s && s.herkunft === 'vscode' && (
            <p className="text-[11px] text-muted-foreground mb-1">Geht als eigener Abzweig weiter – dein Verlauf in VS Code bleibt, wie er ist.</p>
          )}
          <div className="flex items-end gap-2">
            <Textarea rows={1} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); senden(); } }}
              placeholder={arbeitet ? 'Weiterschreiben – kommt dran, sobald Claude fertig ist' : 'Antworten oder neue Aufgabe …'}
              className="min-h-[44px] max-h-40 text-base sm:text-sm resize-none [field-sizing:content]" />
            <Button size="icon" className="h-11 w-11 shrink-0" disabled={!text.trim() || sendet} onClick={senden} aria-label="Senden">
              {sendet ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
