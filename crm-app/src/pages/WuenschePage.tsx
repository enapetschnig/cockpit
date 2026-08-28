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
  gesehen_am: string | null;
  kunde?: string | null;
}

const ART: Record<string, { label: string; cls: string }> = {
  wunsch: { label: 'Wunsch', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  fehler: { label: 'Fehler', cls: 'bg-red-50 text-red-700 border-red-200' },
  frage: { label: 'Frage', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};
const STATUS: Record<string, string> = {
  neu: 'Neu', gesehen: 'Gesehen', umgesetzt: 'Umgesetzt', abgelehnt: 'Abgelehnt',
};

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
  const [bildOffen, setBildOffen] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

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
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Meldungen kommen jederzeit herein – alle 60 s nachsehen.
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const gefiltert = useMemo(() => items.filter((w) =>
    (!fApp || w.app_key === fApp) && (!fArt || w.art === fArt) && (!nurOffen || !w.gesehen_am)),
    [items, fApp, fArt, nurOffen]);

  const neu = items.filter((w) => !w.gesehen_am).length;
  const apps = useMemo(() => [...new Set(items.map((w) => w.app_key))], [items]);

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
          {neu > 0 && <Badge className="bg-blue-600">{neu} neu</Badge>}
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Änderungswünsche, Fehler und Fragen aus allen Handwerker-Apps. Die Apps melden selbstständig hierher.
        </p>

        <Card className="p-3 mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">App</span>
          <Button size="sm" variant={!fApp ? 'secondary' : 'outline'} onClick={() => setFApp('')}>alle</Button>
          {apps.map((k) => (
            <Button key={k} size="sm" variant={fApp === k ? 'secondary' : 'outline'} onClick={() => setFApp(k)}>
              {APP_LABEL[k] ?? k}
            </Button>
          ))}
          <span className="text-xs text-muted-foreground mx-1 ml-3">Art</span>
          <Button size="sm" variant={!fArt ? 'secondary' : 'outline'} onClick={() => setFArt('')}>alle</Button>
          {Object.entries(ART).map(([k, v]) => (
            <Button key={k} size="sm" variant={fArt === k ? 'secondary' : 'outline'} onClick={() => setFArt(k)}>{v.label}</Button>
          ))}
          <Button size="sm" variant={nurOffen ? 'secondary' : 'outline'} className="ml-auto"
            onClick={() => setNurOffen((v) => !v)}>
            {nurOffen && <Check className="w-3.5 h-3.5" />} nur ungesehene
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
          const offen = !w.gesehen_am;
          return (
            <Card key={w.id} className={'p-4 mb-3 ' + (offen ? 'border-l-4 border-l-blue-600' : '')}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <strong className="text-[15px]">{w.kunde || (APP_LABEL[w.app_key] ?? w.app_key)}</strong>
                {w.kunde && <span className="text-xs text-muted-foreground">· {APP_LABEL[w.app_key] ?? w.app_key}</span>}
                <span className={'text-xs font-semibold px-2 py-0.5 rounded-full border ' + art.cls}>{art.label}</span>
                <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted">{STATUS[w.status] ?? w.status}</span>
                <span className="text-xs text-muted-foreground ml-auto">{wann(w.erstellt_am)}</span>
              </div>

              <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{w.text}</div>

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

              {w.bild_pfad && (
                <div className="mt-3">
                  {bildOffen === w.id ? (
                    <img src={datei(w, 'bild')} alt="Screenshot" className="max-w-full rounded-lg border" />
                  ) : (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBildOffen(w.id)}>
                      <ImageIcon className="w-4 h-4" /> Screenshot ansehen
                    </Button>
                  )}
                </div>
              )}

              {w.audio_pfad && (
                <audio controls preload="none" src={datei(w, 'audio')} className="mt-3 w-full max-w-xs" />
              )}

              <div className="mt-3 flex items-center gap-3">
                <Button size="sm" variant={offen ? 'default' : 'outline'} onClick={() => gesehen(w)}>
                  {offen ? 'Gesehen' : '✓ gesehen – rückgängig'}
                </Button>
                <span className="text-xs text-muted-foreground">Erledigt wird in der App selbst gepflegt.</span>
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
