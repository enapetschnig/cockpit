/**
 * Eine App: neue Aufgabe an Claude schreiben, alle Sitzungen (Handy, VS Code, Roboter) und Pause/Weiter für den
 * Roboter bei dieser App. Antippen einer Sitzung → Verlauf (SitzungSeite).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppNav } from '@/components/AppNav';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RoboterSteuerung } from '@/components/RoboterSteuerung';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useRoboterPuls } from '@/hooks/useRoboterPuls';
import { APP_LABEL } from '@/lib/apps';
import { HERKUNFT, SITZUNG_FELDER, sitzungStarten, wann, type Sitzung } from '@/lib/sitzungen';
import { AlertTriangle, ArrowLeft, ChevronRight, Clock, Loader2, Send } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export default function AppSeite() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const label = APP_LABEL[key] ?? key;
  const { puls, laden: pulsLaden } = useRoboterPuls();
  const [sitzungen, setSitzungen] = useState<Sitzung[] | null>(null);
  const [text, setText] = useState('');
  const [sendet, setSendet] = useState(false);
  const [alle, setAlle] = useState(false);

  const laden = useCallback(async () => {
    const { data } = await db.from('cockpit_sitzungen').select(SITZUNG_FELDER).eq('app_key', key)
      .order('zuletzt', { ascending: false }).limit(alle ? 200 : 25);
    setSitzungen((data || []) as Sitzung[]);
  }, [key, alle]);
  useEffect(() => { laden(); const t = setInterval(laden, 10_000); return () => clearInterval(t); }, [laden]);

  const starten = async () => {
    const t = text.trim();
    if (!t) return;
    setSendet(true);
    try {
      const id = await sitzungStarten(key, t);
      navigate(`/apps/${encodeURIComponent(key)}/${id}`);
    } catch {
      toast.error('Konnte nicht gesendet werden');
      setSendet(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <Link to="/apps" className="-ml-2 p-2 rounded-lg hover:bg-muted" aria-label="Zurück zu den Apps"><ArrowLeft className="w-5 h-5" /></Link>
          <h1 className="text-xl font-semibold truncate">{label}</h1>
        </div>

        <div className="rounded-xl border bg-card p-3 space-y-2">
          <label htmlFor="aufgabe" className="text-sm font-medium">Was soll Claude in dieser App machen?</label>
          <Textarea id="aufgabe" rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="z. B. „Auf der Stundenseite den Speichern-Knopf größer machen“ – oder eine Frage. Diktieren geht über das Mikrofon der Tastatur."
            className="text-base sm:text-sm" />
          <Button className="h-11 gap-1.5 w-full sm:w-auto" disabled={!text.trim() || sendet} onClick={starten}>
            {sendet ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Neue Sitzung starten
          </Button>
          <p className="text-[11px] text-muted-foreground">Claude arbeitet in einer eigenen Kopie, baut, pusht – und sagt dir, wenn es live ist.</p>
        </div>

        <RoboterSteuerung puls={puls} appKey={key} onBefehl={pulsLaden} />

        <section>
          <h2 className="text-sm font-semibold mb-1.5 px-1">Sitzungen</h2>
          {sitzungen === null ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            : !sitzungen.length ? (
              <p className="text-sm text-muted-foreground px-1">Noch keine. Oben reinschreiben startet die erste.</p>
            ) : (
              <div className="rounded-xl border bg-card divide-y overflow-hidden">
                {sitzungen.map((s) => (
                  <Link key={s.id} to={`/apps/${encodeURIComponent(key)}/${s.id}`} className="flex items-center gap-3 px-4 py-3 min-h-[3.5rem] hover:bg-muted/50 active:bg-muted">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium line-clamp-2">{s.titel.replace(/^(Roboter|Cockpit) · [^·]+ · /, '')}</div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <span className={'px-1.5 py-px rounded-full border text-[10px] font-semibold ' + HERKUNFT[s.herkunft].cls}>{HERKUNFT[s.herkunft].label}</span>
                        {s.status === 'laeuft' && <span className="text-blue-700 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> arbeitet</span>}
                        {s.status === 'wartet' && <span className="text-amber-700 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> wartet</span>}
                        {s.status === 'fehler' && <span className="text-red-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Fehler</span>}
                        <span>{wann(s.zuletzt)}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          {sitzungen && sitzungen.length >= 25 && !alle && (
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAlle(true)}>Ältere zeigen</Button>
          )}
          <p className="text-[11px] text-muted-foreground mt-2 px-1">
            Dieselben Verläufe findest du in VS Code: Projektordner der App → Claude → Verläufe („Cockpit · …“ von hier, „Roboter · …“ von den Aufträgen).
            Was du in VS Code machst, erscheint hier innerhalb von 2 Minuten.
          </p>
        </section>
      </main>
    </div>
  );
}
