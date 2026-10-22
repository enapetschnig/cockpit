/**
 * Mahnwesen: überfällige Rechnungen auf einen Blick, Zahlungserinnerung /
 * Mahnung / letzte Mahnung als PDF erstellen – herunterladen und selbst
 * verschicken (das CRM mailt nichts). Jede erstellte Mahnung wird vermerkt.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySettings, useDocuments } from '@/hooks/useBilling';
import { eur, fmtDate, openAmount, type BillingDocument, type DocumentItem } from '@/types/billing';
import { buildMahnungPdf, mahnText, mahnungDateiname, STUFE_TITEL, type MahnStufe } from '@/lib/mahnungPdf';
import { AlertTriangle, Download, FileWarning, Loader2 } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Mahnung {
  id: string; document_id: string; stufe: MahnStufe; datum: string; frist: string | null;
  offen: number; sperre: boolean; text: string;
}

const RECHNUNGEN = ['invoice', 'partial_invoice', 'final_invoice'] as const;
const heute = () => new Date().toISOString().slice(0, 10);
const inTagen = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const tageUeber = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0);
const STUFE_FARBE: Record<MahnStufe, string> = {
  1: 'bg-amber-100 text-amber-800', 2: 'bg-orange-100 text-orange-800', 3: 'bg-red-100 text-red-800',
};

export default function MahnwesenPage() {
  const { documents, isLoading, reload } = useDocuments([...RECHNUNGEN]);
  const { settings } = useCompanySettings();
  const [mahnungen, setMahnungen] = useState<Mahnung[]>([]);
  const [offen, setOffen] = useState<BillingDocument | null>(null);
  const [sp] = useSearchParams();

  const ladeMahnungen = useCallback(async () => {
    const { data } = await db.from('mahnungen').select('*').order('datum', { ascending: false }).order('erstellt_am', { ascending: false });
    setMahnungen((data || []) as Mahnung[]);
  }, []);
  useEffect(() => { ladeMahnungen(); }, [ladeMahnungen]);

  const jeRechnung = useMemo(() => {
    const m = new Map<string, Mahnung[]>();
    for (const x of mahnungen) m.set(x.document_id, [...(m.get(x.document_id) || []), x]);
    return m;
  }, [mahnungen]);

  // Überfällig = noch nicht (ganz) bezahlt und Fälligkeit vorbei – oder schon gemahnt.
  const liste = useMemo(() => documents
    .filter((d) => openAmount(d) > 0 && ((d.due_date && d.due_date < heute()) || jeRechnung.has(d.id)))
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')), [documents, jeRechnung]);
  const summe = liste.reduce((a, d) => a + openAmount(d), 0);

  // Aus der Buchhaltung kommend (?beleg=…): gleich den Dialog öffnen.
  useEffect(() => {
    const id = sp.get('beleg');
    if (id && !offen) { const d = documents.find((x) => x.id === id); if (d) setOffen(d); }
  }, [sp, documents, offen]);

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileWarning className="w-6 h-6" /> Mahnwesen</h1>
          <p className="text-sm text-muted-foreground">
            {liste.length} überfällige Rechnungen · offen <b className="text-foreground">{eur(summe)}</b> · Erinnerung oder Mahnung als PDF erstellen und selbst verschicken.
          </p>
        </div>

        {isLoading ? <p className="text-muted-foreground">Laden …</p> : liste.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">Nichts überfällig. 🎉</Card>
        ) : (
          <div className="space-y-2">
            {liste.map((d) => {
              const verlauf = jeRechnung.get(d.id) || [];
              const letzte = verlauf[0];
              return (
                <Card key={d.id} className="p-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link to={`/beleg/${d.id}`} className="font-semibold hover:underline">{d.number}</Link>
                        {letzte && (
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STUFE_FARBE[letzte.stufe]}`}>
                            {STUFE_TITEL[letzte.stufe]} am {fmtDate(letzte.datum)}{letzte.frist ? ` · Frist ${fmtDate(letzte.frist)}` : ''}
                          </span>
                        )}
                        {letzte?.frist && letzte.frist < heute() && (
                          <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 gap-1"><AlertTriangle className="w-3 h-3" /> Frist abgelaufen</Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">{d.recipient_company || d.recipient_name || '—'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{eur(openAmount(d))}</div>
                      <div className="text-xs text-red-600 font-medium">{d.due_date ? `${tageUeber(d.due_date)} Tage überfällig` : 'ohne Fälligkeit'}</div>
                    </div>
                    <Button size="sm" className="gap-1" onClick={() => setOffen(d)}>
                      <FileWarning className="w-4 h-4" /> {letzte ? (letzte.stufe < 3 ? STUFE_TITEL[(letzte.stufe + 1) as MahnStufe] : 'Nochmal mahnen') : 'Zahlungserinnerung'}
                    </Button>
                  </div>
                  {verlauf.length > 0 && (
                    <div className="mt-2 pt-2 border-t flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {verlauf.map((m) => (
                        <button key={m.id} className="hover:underline flex items-center gap-1" title="PDF nochmal herunterladen"
                          onClick={() => herunterladen(d, settings, m.stufe, m.datum, m.frist || inTagen(7), Number(m.offen), m.text, true)}>
                          <Download className="w-3 h-3" /> {STUFE_TITEL[m.stufe]} {fmtDate(m.datum)}
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {offen && (
        <MahnDialog doc={offen} letzte={(jeRechnung.get(offen.id) || [])[0]} settings={settings}
          onClose={() => setOffen(null)} onFertig={() => { setOffen(null); ladeMahnungen(); reload(); }} />
      )}
    </div>
  );
}

async function herunterladen(
  doc: BillingDocument, settings: ReturnType<typeof useCompanySettings>['settings'], stufe: MahnStufe,
  datum: string, frist: string, offen: number, text: string, rechnungAnhaengen: boolean,
) {
  const { data: items } = await db.from('document_items').select('*').eq('document_id', doc.id).order('position');
  const pdf = await buildMahnungPdf(doc, (items || []) as DocumentItem[], settings, { stufe, datum, frist, offen, text, rechnungAnhaengen });
  pdf.save(mahnungDateiname(doc, stufe));
}

function MahnDialog({ doc, letzte, settings, onClose, onFertig }: {
  doc: BillingDocument; letzte?: Mahnung; settings: ReturnType<typeof useCompanySettings>['settings'];
  onClose: () => void; onFertig: () => void;
}) {
  const vorschlag: MahnStufe = letzte ? (Math.min(3, letzte.stufe + 1) as MahnStufe) : 1;
  const [stufe, setStufe] = useState<MahnStufe>(vorschlag);
  const [frist, setFrist] = useState(inTagen(7));
  const [sperre, setSperre] = useState(vorschlag >= 2);
  const [wasSperren, setWasSperren] = useState('den Zugang zur Software');
  const [anhaengen, setAnhaengen] = useState(true);
  const [text, setText] = useState('');
  const [selbstGeaendert, setSelbstGeaendert] = useState(false);
  const [busy, setBusy] = useState(false);
  const offen = openAmount(doc);
  const absender = (() => { try { return localStorage.getItem('vertrag-vertreter') || 'Christoph Napetschnig'; } catch { return 'Christoph Napetschnig'; } })();

  // Text folgt Stufe/Frist/Sperre – bis man ihn selbst ändert.
  useEffect(() => {
    if (selbstGeaendert) return;
    setText(mahnText(doc, { stufe, frist, offen, sperre, wasSperren, absender, firma: settings?.company_name || 'ePower GmbH' }));
  }, [doc, stufe, frist, offen, sperre, wasSperren, absender, settings, selbstGeaendert]);

  const erstellen = async () => {
    setBusy(true);
    try {
      await herunterladen(doc, settings, stufe, heute(), frist, offen, text, anhaengen);
      const { error } = await db.from('mahnungen').insert({ document_id: doc.id, stufe, datum: heute(), frist, offen, sperre, text });
      if (error) { toast.error('PDF erstellt, aber nicht vermerkt: ' + error.message); return; }
      await db.from('documents').update({
        status: Number(doc.paid_amount) > 0 ? doc.status : 'overdue',
        notes: `${doc.notes ? doc.notes + '\n' : ''}${STUFE_TITEL[stufe]} erstellt am ${fmtDate(heute())} (Frist ${fmtDate(frist)})`,
      }).eq('id', doc.id);
      toast.success(`${STUFE_TITEL[stufe]} ${doc.number} heruntergeladen`);
      onFertig();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{STUFE_TITEL[stufe]} · Rechnung {doc.number} · {doc.recipient_company || doc.recipient_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Rechnung vom {fmtDate(doc.doc_date)} über {eur(Number(doc.gross))}, fällig seit {fmtDate(doc.due_date)} ({tageUeber(doc.due_date)} Tage) · offen <b className="text-foreground">{eur(offen)}</b>
          </div>
          <div className="flex flex-wrap gap-2">
            {([1, 2, 3] as MahnStufe[]).map((s) => (
              <Button key={s} size="sm" variant={stufe === s ? 'default' : 'outline'}
                onClick={() => { setStufe(s); if (s >= 2) setSperre(true); }}>{STUFE_TITEL[s]}</Button>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Zahlbar bis</Label>
              <Input type="date" value={frist} onChange={(e) => setFrist(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm mt-5 cursor-pointer">
              <input type="checkbox" checked={anhaengen} onChange={(e) => setAnhaengen(e.target.checked)} />
              Rechnung hinten anhängen (eine PDF)
            </label>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={sperre} onChange={(e) => setSperre(e.target.checked)} />
              Deaktivierung der Software androhen
            </label>
            {sperre && <Input value={wasSperren} onChange={(e) => setWasSperren(e.target.value)} placeholder="z. B. den Zugang zur Zeiterfassung" />}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Brieftext</Label>
              {selbstGeaendert && (
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => setSelbstGeaendert(false)}>Vorschlag wiederherstellen</button>
              )}
            </div>
            <Textarea rows={14} value={text} onChange={(e) => { setText(e.target.value); setSelbstGeaendert(true); }} className="text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
            <Button className="gap-2" disabled={busy || !text.trim() || !frist} onClick={erstellen}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PDF herunterladen
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground text-right">Es wird nichts verschickt – die Mahnung wird nur vermerkt.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
