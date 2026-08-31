/**
 * Eigener Bereich „Wünsche": alle Änderungswünsche, Fehler und Fragen aus den
 * Handwerker-Apps. Die Apps schicken sie selbst hierher (Datenbank-Trigger auf
 * /api/wuensche-eingang); hier wird nur gelesen und „gesehen" vermerkt.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { APP_LABEL, APPS } from '@/lib/apps';
import { Loader2, Image as ImageIcon, Check, Inbox } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Wunsch {
  id: string;
  app_key: string;
  customer_id: string | null;
  art: string;
  status: string;
  text: string;
  antwort: string | null;
  seite: string | null;
  melder: string | null;
  bild_pfad: string | null;
  audio_pfad: string | null;
  erstellt_am: string;
  aktualisiert: string;
  gesehen_am: string | null;
  kunde?: string | null;
}

const ART: Record<string, { label: string; cls: string }> = {
  wunsch: { label: 'Wunsch', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  fehler: { label: 'Fehler', cls: 'bg-red-50 text-red-700 border-red-200' },
  frage: { label: 'Frage', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};
const STATUS: Record<string, { label: string; cls: string }> = {
  neu:       { label: 'Neu',       cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  gesehen:   { label: 'In Arbeit', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  umgesetzt: { label: '✓ Erledigt', cls: 'bg-green-100 text-green-800 border-green-300 font-bold' },
  abgelehnt: { label: 'Abgelehnt', cls: 'bg-muted text-muted-foreground border-border' },
};

/** Offen = in der App noch nicht erledigt oder abgelehnt. */
const istOffen = (w: { status: string }) => w.status !== 'umgesetzt' && w.status !== 'abgelehnt';

function wann(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 3600) return `vor ${Math.max(1, Math.floor(diff / 60))} Min`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`;
  if (diff < 7 * 86400) return `vor ${Math.floor(diff / 86400)} Tg`;
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export default function WuenschePage() {
  const [items, setItems] = useState<Wunsch[]>([]);
  const [loading, setLoading] = useState(true);
  const [fApp, setFApp] = useState('');
  const [fArt, setFArt] = useState('');
  const [nurOffen, setNurOffen] = useState(false);
  const [fStatus, setFStatus] = useState('');
  const [bildOffen, setBildOffen] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [kunden, setKunden] = useState<{ id: string; name: string; app_key: string }[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  const load = useCallback(async () => {
    const { data: ws } = await db.from('app_wuensche').select('*').order('erstellt_am', { ascending: false }).limit(300);
    const list = (ws as Wunsch[]) || [];
    // Kundennamen in einem Zug nachladen statt je Zeile
    const ids = [...new Set(list.map((w) => w.customer_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: cs } = await db.from('customers').select('id, company_name, first_name, last_name').in('id', ids);
      const byId = new Map<string, string | null>((cs || []).map((c: Record<string, string | null>) => [
        String(c.id),
        c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
      ]));
      for (const w of list) w.kunde = w.customer_id ? byId.get(w.customer_id) ?? null : null;
    }
    setItems(list);

    // ALLE Kunden mit App-Zuordnung – auch die, von denen noch nichts kam.
    // Sonst sähe man nicht, dass eine App überhaupt angebunden ist.
    const { data: zug } = await db.from('customers')
      .select('id, company_name, first_name, last_name, app_key').not('app_key', 'is', null);
    setKunden(((zug || []) as Record<string, string | null>[]).map((c) => ({
      id: String(c.id),
      name: c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || String(c.app_key),
      app_key: String(c.app_key),
    })).sort((a, b) => a.name.localeCompare(b.name, 'de')));

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Meldungen kommen jederzeit herein – alle 60 s nachsehen.
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const gefiltert = useMemo(() => items.filter((w) =>
    (!fApp || w.app_key === fApp) && (!fArt || w.art === fArt)
    && (!fStatus || w.status === fStatus) && (!nurOffen || istOffen(w))),
    [items, fApp, fArt, fStatus, nurOffen]);

  const neu = items.filter(istOffen).length;
  const ungelesen = items.filter((w) => !w.gesehen_am && istOffen(w)).length;

  /** Eine Kachel je angebundenem Kunden – plus Apps, die (noch) keinem zugeordnet sind. */
  const uebersicht = useMemo(() => {
    const zaehl = new Map<string, { offen: number; gesamt: number; erledigt: number }>();
    for (const w of items) {
      const e = zaehl.get(w.app_key) ?? { offen: 0, gesamt: 0, erledigt: 0 };
      e.gesamt++;
      if (istOffen(w)) e.offen++;
      if (w.status === 'umgesetzt') e.erledigt++;
      zaehl.set(w.app_key, e);
    }
    const zugeordnet = kunden.map((k) => ({
      key: k.app_key, name: k.name, app: APP_LABEL[k.app_key] ?? k.app_key,
      ...(zaehl.get(k.app_key) ?? { offen: 0, gesamt: 0, erledigt: 0 }),
    }));
    // Meldungen ohne zugeordneten Kunden trotzdem zeigen
    const ohne = [...zaehl.keys()]
      .filter((k) => !kunden.some((x) => x.app_key === k))
      .map((k) => ({ key: k, name: APP_LABEL[k] ?? k, app: 'kein Kunde zugeordnet', ...zaehl.get(k)! }));
    return [...zugeordnet, ...ohne].sort((a, b) => b.offen - a.offen || a.name.localeCompare(b.name, 'de'));
  }, [items, kunden]);

  async function gesehen(w: Wunsch) {
    const wert = w.gesehen_am ? null : new Date().toISOString();
    setItems((xs) => xs.map((x) => (x.id === w.id ? { ...x, gesehen_am: wert } : x)));
    const { error } = await db.from('app_wuensche').update({ gesehen_am: wert }).eq('id', w.id);
    if (error) { toast.error('Konnte nicht gespeichert werden'); load(); }
  }

  const datei = (w: Wunsch, art: 'bild' | 'audio') =>
    `/api/wuensche-datei?id=${encodeURIComponent(w.id)}&art=${art}&token=${encodeURIComponent(token ?? '')}`;

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-baseline gap-3 mb-1">
          <h1 className="text-2xl font-bold">Wünsche</h1>
          {neu > 0 && <Badge className="bg-blue-600">{neu} offen</Badge>}
          {ungelesen > 0 && <span className="text-xs text-muted-foreground">davon {ungelesen} noch nicht angesehen</span>}
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Änderungswünsche, Fehler und Fragen aus allen Handwerker-Apps. Die Apps melden selbstständig hierher.
        </p>

        {/* Kundenübersicht: auf einen Blick sehen, wo etwas offen ist */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
          <button
            onClick={() => setFApp('')}
            className={'text-left rounded-xl border p-3 transition-colors ' +
              (!fApp ? 'border-primary bg-primary/5' : 'bg-card hover:bg-accent/50')}
          >
            <div className="font-semibold text-sm">Alle Kunden</div>
            <div className="text-xs text-muted-foreground mb-1.5">{uebersicht.length} angebunden</div>
            <div className="flex items-center gap-1.5">
              <span className={'text-2xl font-bold ' + (neu ? 'text-blue-600' : 'text-muted-foreground')}>{neu}</span>
              <span className="text-xs text-muted-foreground">offen</span>
            </div>
          </button>

          {uebersicht.map((u) => (
            <button
              key={u.key}
              onClick={() => setFApp(fApp === u.key ? '' : u.key)}
              className={'text-left rounded-xl border p-3 transition-colors ' +
                (fApp === u.key ? 'border-primary bg-primary/5' : 'bg-card hover:bg-accent/50')}
            >
              <div className="font-semibold text-sm leading-tight line-clamp-2" title={u.name}>{u.name}</div>
              <div className="text-xs text-muted-foreground mb-1.5">{u.app}</div>
              <div className="flex items-baseline gap-1.5">
                <span className={'text-2xl font-bold ' + (u.offen ? 'text-blue-600' : 'text-muted-foreground')}>{u.offen}</span>
                <span className="text-xs text-muted-foreground">offen</span>
                {u.gesamt > 0 && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {u.gesamt} gesamt{u.erledigt ? ` · ${u.erledigt} erledigt` : ''}
                  </span>
                )}
              </div>
              {u.gesamt === 0 && (
                <div className="text-[11px] text-muted-foreground mt-0.5">noch keine Meldung</div>
              )}
            </button>
          ))}
        </div>

        <Card className="p-3 mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mx-1">Art</span>
          <Button size="sm" variant={!fArt ? 'secondary' : 'outline'} onClick={() => setFArt('')}>alle</Button>
          {Object.entries(ART).map(([k, v]) => (
            <Button key={k} size="sm" variant={fArt === k ? 'secondary' : 'outline'} onClick={() => setFArt(k)}>{v.label}</Button>
          ))}
          <span className="text-xs text-muted-foreground mx-1 ml-3">Stand</span>
          <Button size="sm" variant={!fStatus ? 'secondary' : 'outline'} onClick={() => setFStatus('')}>alle</Button>
          {Object.entries(STATUS).map(([k, v]) => (
            <Button key={k} size="sm" variant={fStatus === k ? 'secondary' : 'outline'} onClick={() => setFStatus(k)}>{v.label}</Button>
          ))}
          <Button size="sm" variant={nurOffen ? 'secondary' : 'outline'} className="ml-auto"
            onClick={() => setNurOffen((v) => !v)}>
            {nurOffen && <Check className="w-3.5 h-3.5" />} nur offene
          </Button>
        </Card>

        {loading ? (
          <Card className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Lade …
          </Card>
        ) : !gefiltert.length ? (
          <Card className="p-8 text-center">
            <Inbox className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {items.length ? 'Keine Meldung passt zu diesem Filter.'
                : 'Noch keine Meldungen. Sobald eine App scharfgeschaltet ist, erscheinen die Wünsche hier automatisch.'}
            </p>
          </Card>
        ) : gefiltert.map((w) => {
          const art = ART[w.art] ?? { label: w.art, cls: 'bg-muted text-muted-foreground' };
          const st = STATUS[w.status] ?? { label: w.status, cls: 'bg-muted text-muted-foreground border-border' };
          const offen = istOffen(w);
          const ungesehen = !w.gesehen_am;
          // Wurde in der App weiterbearbeitet, nicht nur gemeldet?
          const bearbeitet = w.status !== 'neu'
            && new Date(w.aktualisiert).getTime() - new Date(w.erstellt_am).getTime() > 60_000;
          const erledigt = w.status === 'umgesetzt';
          return (
            <Card key={w.id} className={'p-4 mb-3 ' +
              (erledigt ? 'border-l-4 border-l-green-600' : offen ? 'border-l-4 border-l-blue-600' : '')}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <strong className="text-[15px]">{w.kunde || (APP_LABEL[w.app_key] ?? w.app_key)}</strong>
                {w.kunde && <span className="text-xs text-muted-foreground">· {APP_LABEL[w.app_key] ?? w.app_key}</span>}
                <span className={'text-xs font-semibold px-2 py-0.5 rounded-full border ' + art.cls}>{art.label}</span>
                <span className={'text-xs font-semibold px-2 py-0.5 rounded-full border ' + st.cls}>{st.label}</span>
                <span className="text-xs text-muted-foreground ml-auto">{wann(w.erstellt_am)}</span>
              </div>

              <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{w.text}</div>

              {bearbeitet && (
                <div className={'mt-2 text-xs font-semibold ' + (erledigt ? 'text-green-700' : 'text-amber-700')}>
                  {erledigt ? '✓ In der App als erledigt gekennzeichnet' : 'In der App bearbeitet'} · {wann(w.aktualisiert)}
                </div>
              )}

              {(w.melder || w.seite) && (
                <div className="text-xs text-muted-foreground mt-1.5">
                  {w.melder && <>von {w.melder}</>}{w.melder && w.seite && ' · '}{w.seite && <>Seite: {w.seite}</>}
                </div>
              )}

              {w.antwort && (
                <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                  <div className="text-xs font-semibold text-muted-foreground mb-0.5">Antwort in der App</div>
                  <div className="whitespace-pre-wrap">{w.antwort}</div>
                </div>
              )}

              {w.bild_pfad && token && (
                <div className="mt-3">
                  {/* Direkt sichtbar – man soll nicht erst klicken müssen, um zu
                      verstehen, worum es geht. Klick vergrößert auf volle Breite. */}
                  <img
                    src={datei(w, 'bild')}
                    alt="Bildschirmfoto aus der App"
                    loading="lazy"
                    onClick={() => setBildOffen(bildOffen === w.id ? null : w.id)}
                    className={'rounded-lg border cursor-zoom-in bg-muted/30 ' +
                      (bildOffen === w.id ? 'w-full cursor-zoom-out' : 'max-h-56 object-contain')}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" />
                    {bildOffen === w.id ? 'Klick zum Verkleinern' : 'Klick zum Vergrößern'}
                  </div>
                </div>
              )}

              {w.audio_pfad && (
                <audio controls preload="none" src={datei(w, 'audio')} className="mt-3 w-full max-w-xs" />
              )}

              <div className="mt-3 flex items-center gap-3">
                <Button size="sm" variant={ungesehen ? 'default' : 'outline'} onClick={() => gesehen(w)}>
                  {ungesehen ? 'Gelesen' : '✓ gelesen – rückgängig'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Ob ein Wunsch erledigt ist, wird in der App gepflegt – „gelesen" ist nur ein Merker für dich.
                </span>
              </div>
            </Card>
          );
        })}

        {!loading && (
          <p className="text-[11px] text-muted-foreground mt-4">
            Angebundene Apps: {APPS.map((a) => a.label).join(' · ')}
          </p>
        )}
      </main>
    </div>
  );
}
