/**
 * Besprechungen aus Plaud – der PC holt die Aufnahmen, Claude ordnet sie einem
 * Kunden oder Lead zu und legt Zusammenfassung + Handlungsschritte ab
 * (crm.besprechungen). Hier: lesen, Schritte abhaken, bei Bedarf umhängen.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Mic } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Schritt { text: string; erledigt?: boolean }
export interface Besprechung {
  id: string;
  titel: string | null;
  beginn: string | null;
  dauer_sek: number | null;
  customer_id: string | null;
  lead_id: string | null;
  status: 'zugeordnet' | 'unklar' | 'ignoriert';
  begruendung: string | null;
  zusammenfassung: string | null;
  handlungsschritte: Schritt[] | null;
  plaud_zusammenfassung: string | null;
  transkript: string | null;
  customers?: { company_name: string | null; first_name: string | null; last_name: string | null } | null;
  leads?: { company_name: string | null; full_name: string | null } | null;
}

/** Kleines Markdown: Überschriften, Listen, **fett** – mehr liefern Claude und Plaud hier nicht. */
function Md({ text }: { text: string }) {
  const fett = (z: string) => z.split(/(\*\*[^*]+\*\*)/g).map((t, i) =>
    t.startsWith('**') && t.endsWith('**') ? <strong key={i}>{t.slice(2, -2)}</strong> : t);
  const bloecke: JSX.Element[] = [];
  let punkte: string[] = [];
  const liste = () => {
    if (punkte.length) bloecke.push(<ul key={bloecke.length} className="list-disc pl-5 space-y-0.5">{punkte.map((p, i) => <li key={i}>{fett(p)}</li>)}</ul>);
    punkte = [];
  };
  for (const roh of text.split('\n')) {
    const z = roh.trim();
    const p = z.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (p) { punkte.push(p[1]); continue; }
    liste();
    if (!z) continue;
    const h = z.match(/^#{1,6}\s+(.*)$/);
    bloecke.push(h ? <div key={bloecke.length} className="font-medium mt-2">{fett(h[1])}</div> : <p key={bloecke.length}>{fett(z)}</p>);
  }
  liste();
  return <div className="space-y-1 text-sm">{bloecke}</div>;
}

const AUSWAHL = '*, customers(company_name, first_name, last_name), leads(company_name, full_name)';

const wer = (b: Besprechung) =>
  b.customers ? (b.customers.company_name || [b.customers.first_name, b.customers.last_name].filter(Boolean).join(' ')) :
  b.leads ? `${b.leads.company_name || b.leads.full_name} (Lead)` : null;

const datum = (s: string | null) => s
  ? new Date(s).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '';

/** Besprechungen laden: für einen Kunden/Lead oder alle (neueste zuerst). */
export function useBesprechungen(f: { customerId?: string | null; leadId?: string | null; alle?: boolean }) {
  const [liste, setListe] = useState<Besprechung[]>([]);
  const [laedt, setLaedt] = useState(true);
  const laden = useCallback(async () => {
    if (!f.alle && !f.customerId && !f.leadId) { setListe([]); setLaedt(false); return; }
    let q = db.from('besprechungen').select(AUSWAHL).order('beginn', { ascending: false }).limit(200);
    if (!f.alle) {
      const oder = [f.customerId && `customer_id.eq.${f.customerId}`, f.leadId && `lead_id.eq.${f.leadId}`].filter(Boolean).join(',');
      q = q.or(oder).eq('status', 'zugeordnet');
    }
    const { data, error } = await q;
    if (error) toast.error('Besprechungen: ' + error.message);
    setListe(data || []);
    setLaedt(false);
  }, [f.alle, f.customerId, f.leadId]);
  useEffect(() => { laden(); }, [laden]);
  return { liste, laedt, laden };
}

/** Kunde/Lead suchen und die Besprechung dort ablegen. */
function Umhaengen({ b, fertig }: { b: Besprechung; fertig: () => void }) {
  const [q, setQ] = useState('');
  const [treffer, setTreffer] = useState<{ art: 'k' | 'l'; id: string; name: string }[]>([]);
  useEffect(() => {
    const s = q.trim().replace(/[%,()]/g, '');
    if (s.length < 2) { setTreffer([]); return; }
    const t = setTimeout(async () => {
      const [k, l] = await Promise.all([
        db.from('customers').select('id, company_name, first_name, last_name, city')
          .or(`company_name.ilike.%${s}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%`).limit(6),
        db.from('leads').select('id, company_name, full_name').or(`company_name.ilike.%${s}%,full_name.ilike.%${s}%`).limit(4),
      ]);
      setTreffer([
        ...(k.data || []).map((c: { id: string; company_name: string | null; first_name: string | null; last_name: string | null; city: string | null }) => ({
          art: 'k' as const, id: c.id,
          name: [c.company_name, [c.first_name, c.last_name].filter(Boolean).join(' '), c.city].filter(Boolean).join(' · '),
        })),
        ...(l.data || []).map((x: { id: string; company_name: string | null; full_name: string }) => ({
          art: 'l' as const, id: x.id, name: `${[x.company_name, x.full_name].filter(Boolean).join(' · ')} (Lead)`,
        })),
      ]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const setzen = async (patch: Partial<Besprechung>) => {
    const { error } = await db.from('besprechungen').update({ ...patch, aktualisiert: new Date().toISOString() }).eq('id', b.id);
    if (error) toast.error(error.message); else fertig();
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kunde oder Lead suchen …" className="h-8 text-sm" />
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setzen({ status: 'ignoriert', customer_id: null, lead_id: null })}>Privat</Button>
      </div>
      {treffer.map((t) => (
        <button key={t.art + t.id} className="block w-full text-left text-sm px-2 py-1 rounded hover:bg-muted"
          onClick={() => setzen({ status: 'zugeordnet', customer_id: t.art === 'k' ? t.id : null, lead_id: t.art === 'l' ? t.id : null })}>
          {t.name}
        </button>
      ))}
    </div>
  );
}

export function BesprechungKarte({ b, mitWer, neuLaden }: { b: Besprechung; mitWer?: boolean; neuLaden: () => void }) {
  const [schritte, setSchritte] = useState<Schritt[]>(b.handlungsschritte || []);
  const [umhaengen, setUmhaengen] = useState(b.status === 'unklar');
  useEffect(() => setSchritte(b.handlungsschritte || []), [b.handlungsschritte]);

  const abhaken = async (i: number) => {
    const neu = schritte.map((s, j) => (j === i ? { ...s, erledigt: !s.erledigt } : s));
    setSchritte(neu);
    const { error } = await db.from('besprechungen').update({ handlungsschritte: neu }).eq('id', b.id);
    if (error) { toast.error(error.message); setSchritte(schritte); }
  };
  const name = wer(b);
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Mic className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm leading-snug">{b.titel || 'Besprechung'}</div>
          <div className="text-xs text-muted-foreground">
            {datum(b.beginn)}{b.dauer_sek ? ` · ${Math.max(1, Math.round(b.dauer_sek / 60))} Min.` : ''}
            {mitWer && name && <> · <span className="text-foreground">{name}</span></>}
          </div>
        </div>
        {b.status === 'unklar' && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Zuordnen</Badge>}
        {b.status === 'ignoriert' && <Badge variant="outline" className="text-muted-foreground">Privat</Badge>}
        {mitWer && b.status !== 'unklar' && (
          <button className="text-xs text-muted-foreground hover:underline" onClick={() => setUmhaengen((x) => !x)}>ändern</button>
        )}
      </div>
      {umhaengen && <Umhaengen b={b} fertig={() => { setUmhaengen(false); neuLaden(); }} />}
      {b.zusammenfassung && (
        <Md text={b.zusammenfassung} />
      )}
      {schritte.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Handlungsschritte</div>
          {schritte.map((s, i) => (
            <label key={i} className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-1" checked={!!s.erledigt} onChange={() => abhaken(i)} />
              <span className={s.erledigt ? 'line-through text-muted-foreground' : ''}>{s.text}</span>
            </label>
          ))}
        </div>
      )}
      {(b.plaud_zusammenfassung || b.transkript) && (
        <details className="text-sm">
          <summary className="text-xs text-muted-foreground cursor-pointer">Plaud-Zusammenfassung & Transkript</summary>
          {b.plaud_zusammenfassung && (
            <div className="mt-2"><Md text={b.plaud_zusammenfassung} /></div>
          )}
          {b.transkript && <pre className="whitespace-pre-wrap text-xs mt-2 max-h-80 overflow-auto bg-muted/50 p-2 rounded">{b.transkript}</pre>}
        </details>
      )}
    </Card>
  );
}

/** Kompakt beim Kunden bzw. Lead. */
export function BesprechungenBei({ customerId, leadId }: { customerId?: string | null; leadId?: string | null }) {
  const { liste, laedt, laden } = useBesprechungen({ customerId, leadId });
  if (laedt) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (!liste.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Besprechungen</div>
      {liste.map((b) => <BesprechungKarte key={b.id} b={b} neuLaden={laden} />)}
    </div>
  );
}
