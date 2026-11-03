/**
 * „Apps“ – alle Kunden-Apps auf einen Blick, gebaut fürs Handy (03.11.2026): Roboter-Status mit Pause/Weiter,
 * was auf Christoph wartet, und je App, ob dort gerade gearbeitet wird. Antippen → Sitzungen der App (AppSeite).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppNav } from '@/components/AppNav';
import { Input } from '@/components/ui/input';
import { RoboterSteuerung } from '@/components/RoboterSteuerung';
import { supabase } from '@/integrations/supabase/client';
import { useRoboterPuls } from '@/hooks/useRoboterPuls';
import { APPS } from '@/lib/apps';
import { WARTET_AUF_DICH } from '@/lib/heute';
import { pausiertBis, uhrzeit, wann, type Sitzung } from '@/lib/sitzungen';
import { ChevronRight, Loader2, Search } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Kurz = Pick<Sitzung, 'app_key' | 'zuletzt' | 'status'>;

export default function AppsPage() {
  const { puls, laden: pulsLaden } = useRoboterPuls();
  const [sitzungen, setSitzungen] = useState<Kurz[] | null>(null);
  const [offen, setOffen] = useState<Record<string, number>>({});
  const [wartet, setWartet] = useState(0);
  const [suche, setSuche] = useState('');

  const laden = useCallback(async () => {
    const [s, w, a] = await Promise.all([
      db.from('cockpit_sitzungen').select('app_key,zuletzt,status').order('zuletzt', { ascending: false }).limit(1000),
      // „offen“ wie in der Navigation
      db.from('app_wuensche').select('app_key').not('status', 'in', '("umgesetzt","abgelehnt","geloescht")').is('erledigt_am', null).limit(1000),
      db.from('roboter_auftraege').select('id', { count: 'exact', head: true }).in('status', WARTET_AUF_DICH),
    ]);
    setSitzungen((s.data || []) as Kurz[]);
    const z: Record<string, number> = {};
    for (const x of (w.data || []) as { app_key: string }[]) z[x.app_key] = (z[x.app_key] ?? 0) + 1;
    setOffen(z);
    setWartet(a.count ?? 0);
  }, []);
  useEffect(() => { laden(); const t = setInterval(laden, 15_000); return () => clearInterval(t); }, [laden]);

  const liste = useMemo(() => {
    const zuletzt = new Map<string, string>();
    const aktiv = new Set<string>();
    for (const s of sitzungen ?? []) {
      if (!zuletzt.has(s.app_key)) zuletzt.set(s.app_key, s.zuletzt);
      if (s.status === 'laeuft' || s.status === 'wartet') aktiv.add(s.app_key);
    }
    for (const x of puls?.laeuft ?? []) aktiv.add(x.app);
    const q = suche.trim().toLowerCase();
    return APPS
      .filter((a) => !q || a.label.toLowerCase().includes(q) || a.key.includes(q))
      .map((a) => ({ ...a, zuletzt: zuletzt.get(a.key) ?? null, aktiv: aktiv.has(a.key), was: puls?.laeuft.find((x) => x.app === a.key)?.was }))
      .sort((x, y) => Number(y.aktiv) - Number(x.aktiv) || (y.zuletzt ?? '').localeCompare(x.zuletzt ?? '') || x.label.localeCompare(y.label, 'de'));
  }, [sitzungen, puls, suche]);

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        <div className="px-1">
          <h1 className="text-xl font-semibold">Apps</h1>
          <p className="text-sm text-muted-foreground">App antippen, reinschreiben, was Claude machen soll – du siehst live mit.</p>
        </div>

        <RoboterSteuerung puls={puls} onBefehl={pulsLaden} />

        {wartet > 0 && (
          <Link to="/wuensche" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
            <span className="flex-1"><strong>{wartet}</strong> {wartet === 1 ? 'Auftrag wartet' : 'Aufträge warten'} auf dich (Rückfrage oder Freigabe)</span>
            <ChevronRight className="w-4 h-4 text-amber-700" />
          </Link>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="App suchen" className="h-11 pl-9 text-base sm:text-sm" />
        </div>

        {sitzungen === null ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="rounded-xl border bg-card divide-y overflow-hidden">
            {liste.map((a) => {
              const bis = pausiertBis(puls?.pausen, a.key);
              return (
                <Link key={a.key} to={`/apps/${encodeURIComponent(a.key)}`} className="flex items-center gap-3 px-4 py-3 min-h-[3.5rem] hover:bg-muted/50 active:bg-muted">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[15px] truncate">{a.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.aktiv
                        ? <span className="text-blue-700 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {a.was ?? 'Sitzung läuft'}</span>
                        : a.zuletzt ? `zuletzt ${wann(a.zuletzt)}` : 'noch keine Sitzung'}
                      {bis && <span className="text-amber-700"> · pausiert bis {uhrzeit(bis)}</span>}
                    </div>
                  </div>
                  {offen[a.key] > 0 && (
                    <span className="text-[11px] font-bold text-white bg-blue-600 rounded-full px-1.5 py-0.5 leading-none" title="offene Wünsche">{offen[a.key]}</span>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
