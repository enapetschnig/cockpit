import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  useArticles, useCompanySettings, useCustomers, useDocument, nextNumber, reserveNumber, saveDocument,
} from '@/hooks/useBilling';
import {
  DOC_KIND_LABEL, computeTotals, eur, lineNet, customerLabel,
  type BillingDocument, type DocKind, type DocumentItem,
} from '@/types/billing';
import { buildDocumentPdf, documentFileName, epcQr } from '@/lib/documentPdf';
import { LivePreview } from '@/components/billing/LivePreview';
import { sendDocumentMail } from '@/lib/sendMail';
import {
  ArrowLeft, Plus, Trash2, Download, Send, Star, Copy, FileText, Percent, Save, Receipt, Eye,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Item = Partial<DocumentItem> & { _k: string };
const key = () => Math.random().toString(36).slice(2);
const emptyItem = (): Item => ({ _k: key(), name: '', quantity: 1, unit: 'Stk', unit_price: 0, vat_rate: 20, discount_percent: 0, is_heading: false });
const addDays = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

export default function BelegEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'neu';
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const { customers } = useCustomers();
  const { articles, bump } = useArticles();
  const { doc: loaded, items: loadedItems, isLoading, reload } = useDocument(isNew ? undefined : id);

  const [doc, setDoc] = useState<Partial<BillingDocument>>({
    kind: (sp.get('kind') as DocKind) || 'offer',
    status: 'draft',
    doc_date: new Date().toISOString().slice(0, 10),
    discount_percent: 0, deducted_net: 0, deducted_vat: 0,
  });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [custQ, setCustQ] = useState('');
  const [artQ, setArtQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mobilePreview, setMobilePreview] = useState(false);
  const set = (p: Partial<BillingDocument>) => setDoc((d) => ({ ...d, ...p }));

  // Vorhandenen Beleg laden
  useEffect(() => {
    if (loaded) { setDoc(loaded); setMailTo(loaded.recipient_email || ''); }
    if (loadedItems.length) setItems(loadedItems.map((i) => ({ ...i, _k: key() })));
  }, [loaded, loadedItems]);

  // Neuer Beleg: Nummer + Texte + Fristen vorbelegen
  useEffect(() => {
    if (!isNew || !settings || doc.number) return;
    (async () => {
      const kind = (doc.kind as DocKind) || 'offer';
      const num = await nextNumber(kind, settings);
      const today = doc.doc_date || new Date().toISOString().slice(0, 10);
      set({
        number: num,
        intro_text: kind === 'offer' ? settings.offer_intro || '' : settings.invoice_intro || '',
        outro_text: kind === 'offer' ? settings.offer_outro || '' : settings.invoice_outro || '',
        valid_until: kind === 'offer' ? addDays(today, settings.offer_valid_days || 30) : null,
        due_date: kind !== 'offer' ? addDays(today, settings.default_payment_days || 14) : null,
      });
      // aus Lead vorbefüllen
      const leadId = sp.get('lead');
      if (leadId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { supabase } = await import('@/integrations/supabase/client') as any;
        const { data: l } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
        if (l) set({
          lead_id: leadId, recipient_name: l.full_name, recipient_company: l.company_name,
          recipient_email: l.email, title: l.company_name ? `Angebot ${l.company_name}` : undefined,
        });
        if (l?.email) setMailTo(l.email);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, settings, doc.kind]);

  const totals = useMemo(
    () => computeTotals(items.map((i) => ({
      quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0,
      discount_percent: Number(i.discount_percent) || 0, vat_rate: Number(i.vat_rate) || 0, is_heading: !!i.is_heading,
    })), Number(doc.discount_percent) || 0,
    { net: Number(doc.deducted_net) || 0, vat: Number(doc.deducted_vat) || 0 }),
    [items, doc.discount_percent, doc.deducted_net, doc.deducted_vat],
  );

  const custMatches = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s) return [];
    return customers.filter((c) =>
      [c.company_name, c.first_name, c.last_name, c.city, c.email].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))).slice(0, 6);
  }, [custQ, customers]);

  const artMatches = useMemo(() => {
    const s = artQ.trim().toLowerCase();
    const base = s ? articles.filter((a) => a.name.toLowerCase().includes(s) || (a.category || '').toLowerCase().includes(s)) : articles;
    return base.slice(0, s ? 8 : 6);
  }, [artQ, articles]);

  const pickCustomer = (cId: string) => {
    const c = customers.find((x) => x.id === cId); if (!c) return;
    set({
      customer_id: c.id, recipient_name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
      recipient_company: c.company_name, recipient_street: [c.street, c.house_no].filter(Boolean).join(' ') || null,
      recipient_zip: c.postal_code, recipient_city: c.city, recipient_country: c.country,
      recipient_email: c.email, recipient_uid: c.uid_number,
    });
    if (c.email) setMailTo(c.email);
    setCustQ('');
  };

  const addArticle = (aId: string) => {
    const a = articles.find((x) => x.id === aId); if (!a) return;
    setItems((its) => [...its.filter((i) => i.name || i.is_heading), {
      _k: key(), article_id: a.id, name: a.name, description: a.description || undefined,
      quantity: 1, unit: a.unit, unit_price: Number(a.unit_price), vat_rate: Number(a.vat_rate), discount_percent: 0, is_heading: false,
    }]);
    bump(a.id, a.use_count);
    setArtQ('');
  };

  const upd = (k: string, p: Partial<Item>) => setItems((its) => its.map((i) => (i._k === k ? { ...i, ...p } : i)));
  const del = (k: string) => setItems((its) => (its.length > 1 ? its.filter((i) => i._k !== k) : [emptyItem()]));

  const persist = async (extra: Partial<BillingDocument> = {}) => {
    if (!user) return null;
    setBusy(true);
    const merged = { ...doc, ...extra };
    // Verbindliche Nummer erst jetzt ziehen – Entwürfe reißen keine Lücke,
    // und zwei gleichzeitige Speichervorgänge können nie dieselbe Nummer bekommen.
    if (isNew && !merged.number_locked) {
      const n = await reserveNumber((merged.kind as DocKind) || 'offer');
      if (n) { merged.number = n; merged.number_locked = true; setDoc((d) => ({ ...d, number: n, number_locked: true })); }
    }
    const newId = await saveDocument(merged, items.filter((i) => i.name || i.is_heading), user.id);
    setBusy(false);
    if (!newId) return null;
    if (isNew) navigate(`/beleg/${newId}`, { replace: true });
    else { setDoc((d) => ({ ...d, ...extra })); reload(); }
    return newId;
  };

  const makePdf = async () => {
    const full = {
      ...doc, id: doc.id || 'neu', net: totals.net, vat: totals.vat, gross: totals.gross,
    } as BillingDocument;
    let qr: string | null = null;
    if (full.kind !== 'offer' && settings?.iban) {
      qr = await epcQr({ name: settings.company_name || '', iban: settings.iban, bic: settings.bic || '',
        amount: totals.gross, reference: full.number || '' });
    }
    return buildDocumentPdf(full, items.map((i, n) => ({ ...i, position: n } as DocumentItem)), settings, qr);
  };

  const downloadPdf = async () => {
    await persist();
    const pdf = await makePdf();
    pdf.save(documentFileName({ ...doc, id: doc.id || 'x' } as BillingDocument));
  };

  const sendMail = async () => {
    if (!mailTo.trim()) return toast.error('Bitte E-Mail-Adresse angeben');
    const savedId = await persist({ recipient_email: mailTo.trim() });
    if (!savedId) return;
    setBusy(true);
    const pdf = await makePdf();
    const base64 = pdf.output('datauristring').split(',')[1];
    const kindLabel = DOC_KIND_LABEL[(doc.kind as DocKind) || 'offer'];
    const ok = await sendDocumentMail({
      to: mailTo.trim(),
      subject: `${kindLabel} ${doc.number || ''} – ${settings?.company_name || 'ePower GmbH'}`.trim(),
      text: `Guten Tag,\n\nanbei erhalten Sie ${kindLabel === 'Angebot' ? 'unser Angebot' : 'unsere Rechnung'} ${doc.number || ''}.\n\n${doc.outro_text || ''}\n\nBeste Grüße\n${settings?.company_name || 'ePower GmbH'}`,
      fileName: documentFileName({ ...doc, id: savedId } as BillingDocument),
      pdfBase64: base64,
    });
    setBusy(false);
    if (ok) {
      await persist({ status: 'sent', sent_at: new Date().toISOString(), sent_to: mailTo.trim() });
      toast.success('Versendet an ' + mailTo);
    }
  };

  /** Angebot → Rechnung, oder Anzahlungs-/Schlussrechnung erzeugen. */
  const createFollowUp = async (kind: DocKind, percent?: number) => {
    if (!user) return;
    const srcId = doc.id || (await persist());
    if (!srcId) return;
    setBusy(true);
    const num = await nextNumber(kind === 'offer' ? 'offer' : 'invoice', settings);
    const today = new Date().toISOString().slice(0, 10);
    let newItems: Partial<DocumentItem>[];
    let extra: Partial<BillingDocument> = {};

    if (kind === 'partial_invoice' && percent) {
      newItems = [{
        name: `${percent} % Anzahlung`,
        description: `Anzahlung laut ${DOC_KIND_LABEL[(doc.kind as DocKind) || 'offer']} ${doc.number || ''}`.trim(),
        quantity: 1, unit: 'Pauschal', unit_price: Math.round(totals.net * percent) / 100,
        vat_rate: items.find((i) => !i.is_heading)?.vat_rate ?? 20, discount_percent: 0, is_heading: false,
      }];
      extra = { project_total: totals.net, part_percent: percent };
    } else if (kind === 'final_invoice') {
      // Schlussrechnung: volle Leistung + Abzug bereits verrechneter Anzahlungen (österr. konform)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { supabase } = await import('@/integrations/supabase/client') as any;
      const { data: parts } = await supabase.from('documents').select('net,vat')
        .eq('parent_document_id', srcId).eq('kind', 'partial_invoice');
      const dNet = (parts || []).reduce((a: number, p: { net: number }) => a + Number(p.net || 0), 0);
      const dVat = (parts || []).reduce((a: number, p: { vat: number }) => a + Number(p.vat || 0), 0);
      newItems = items.filter((i) => i.name || i.is_heading).map((i) => ({ ...i }));
      extra = { deducted_net: dNet, deducted_vat: dVat };
    } else {
      newItems = items.filter((i) => i.name || i.is_heading).map((i) => ({ ...i }));
    }

    const newId = await saveDocument({
      kind, number: num, status: 'draft', doc_date: today,
      due_date: kind !== 'offer' ? addDays(today, settings?.default_payment_days || 14) : null,
      customer_id: doc.customer_id, lead_id: doc.lead_id,
      recipient_name: doc.recipient_name, recipient_company: doc.recipient_company,
      recipient_street: doc.recipient_street, recipient_zip: doc.recipient_zip,
      recipient_city: doc.recipient_city, recipient_country: doc.recipient_country,
      recipient_email: doc.recipient_email, recipient_uid: doc.recipient_uid,
      title: doc.title, intro_text: settings?.invoice_intro || '', outro_text: settings?.invoice_outro || '',
      source_document: srcId, parent_document_id: kind === 'offer' ? null : srcId,
      discount_percent: doc.discount_percent || 0, ...extra,
    }, newItems, user.id);
    setBusy(false);
    if (newId) { toast.success(`${DOC_KIND_LABEL[kind]} erstellt`); navigate(`/beleg/${newId}`); }
  };

  const kind = (doc.kind as DocKind) || 'offer';
  const isOffer = kind === 'offer';

  if (!isNew && isLoading) return (<div className="min-h-screen bg-background"><BillingNav /><p className="p-8 text-muted-foreground">Laden …</p></div>);

  return (
    <div className="min-h-screen bg-background pb-24">
      <BillingNav />
      <main className="max-w-[1500px] mx-auto px-4 py-5 lg:grid lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-6 lg:items-start">
        <div className="min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1"><ArrowLeft className="w-4 h-4" /> Zurück</Button>
          <Badge variant="outline">{DOC_KIND_LABEL[kind]}</Badge>
          {isNew ? (
            <span className="text-sm text-muted-foreground" title="Die endgültige Nummer wird beim Speichern verbindlich vergeben">
              Vorschlag: <b>{doc.number || '…'}</b>
            </span>
          ) : (
            <Input className="h-8 w-40 font-semibold" value={doc.number || ''}
              onChange={(e) => set({ number: e.target.value })} placeholder="Nummer"
              title="Laufende Nummer – änderbar" />
          )}
          {doc.legacy_source && <Badge variant="outline">Archiv-Beleg</Badge>}
        </div>

        {/* Empfänger */}
        <Card className="p-4 mb-4">
          <Label className="text-xs text-muted-foreground">Kunde</Label>
          <div className="relative">
            <Input placeholder="Kunde suchen (Firma, Name, Ort) …" value={custQ} onChange={(e) => setCustQ(e.target.value)} className="mt-1" />
            {custMatches.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg overflow-hidden">
                {custMatches.map((c) => (
                  <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => pickCustomer(c.id)}>
                    <span className="font-medium">{customerLabel(c)}</span>
                    <span className="text-muted-foreground"> · {[c.postal_code, c.city].filter(Boolean).join(' ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-2 mt-3">
            <Input placeholder="Firma" value={doc.recipient_company || ''} onChange={(e) => set({ recipient_company: e.target.value })} />
            <Input placeholder="Name" value={doc.recipient_name || ''} onChange={(e) => set({ recipient_name: e.target.value })} />
            <Input placeholder="Straße" value={doc.recipient_street || ''} onChange={(e) => set({ recipient_street: e.target.value })} />
            <div className="flex gap-2">
              <Input placeholder="PLZ" className="w-24" value={doc.recipient_zip || ''} onChange={(e) => set({ recipient_zip: e.target.value })} />
              <Input placeholder="Ort" value={doc.recipient_city || ''} onChange={(e) => set({ recipient_city: e.target.value })} />
            </div>
            <Input placeholder="E-Mail" value={doc.recipient_email || ''} onChange={(e) => { set({ recipient_email: e.target.value }); setMailTo(e.target.value); }} />
            <Input placeholder="UID (bei Rechnungen ab 10.000 €)" value={doc.recipient_uid || ''} onChange={(e) => set({ recipient_uid: e.target.value })} />
          </div>
        </Card>

        {/* Kopf */}
        <Card className="p-4 mb-4 grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3">
            <Label className="text-xs text-muted-foreground">Titel</Label>
            <Input value={doc.title || ''} onChange={(e) => set({ title: e.target.value })} placeholder={isOffer ? 'z. B. Individuelle Handwerks-App' : 'z. B. Entwicklung Handwerks-App'} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Datum</Label>
            <Input type="date" value={doc.doc_date || ''} onChange={(e) => set({ doc_date: e.target.value })} />
          </div>
          {isOffer ? (
            <div><Label className="text-xs text-muted-foreground">Gültig bis</Label>
              <Input type="date" value={doc.valid_until || ''} onChange={(e) => set({ valid_until: e.target.value })} /></div>
          ) : (
            <div><Label className="text-xs text-muted-foreground">Fällig am</Label>
              <Input type="date" value={doc.due_date || ''} onChange={(e) => set({ due_date: e.target.value })} /></div>
          )}
          <div><Label className="text-xs text-muted-foreground">Leistungsdatum</Label>
            <Input type="date" value={doc.service_date || ''} onChange={(e) => set({ service_date: e.target.value })} /></div>
          <div className="sm:col-span-3">
            <Label className="text-xs text-muted-foreground">Einleitungstext</Label>
            <Textarea rows={2} value={doc.intro_text || ''} onChange={(e) => set({ intro_text: e.target.value })} />
          </div>
        </Card>

        {/* Positionen */}
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Positionen</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setItems((i) => [...i, { ...emptyItem(), is_heading: true, name: 'Zwischenüberschrift' }])}>Überschrift</Button>
              <Button size="sm" variant="outline" onClick={() => setItems((i) => [...i, emptyItem()])} className="gap-1"><Plus className="w-4 h-4" /> Position</Button>
            </div>
          </div>

          {/* Schnellauswahl aus Vorlagen */}
          <div className="mb-3">
            <Input placeholder="Vorlage suchen und mit Klick hinzufügen …" value={artQ} onChange={(e) => setArtQ(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {artMatches.map((a) => (
                <button key={a.id} onClick={() => addArticle(a.id)}
                  className="text-xs px-2.5 py-1.5 rounded-full border hover:border-primary hover:bg-muted flex items-center gap-1">
                  {a.is_favorite && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
                  {a.name} <span className="text-muted-foreground">· {eur(Number(a.unit_price))}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {items.map((it, idx) => it.is_heading ? (
              <div key={it._k} className="flex gap-2 items-center bg-muted/50 rounded-lg p-2">
                <Input className="font-semibold" value={it.name || ''} onChange={(e) => upd(it._k, { name: e.target.value })} />
                <Button size="icon" variant="ghost" onClick={() => del(it._k)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ) : (
              <div key={it._k} className="border rounded-lg p-2 space-y-2">
                <div className="flex gap-2 items-start">
                  <span className="text-xs text-muted-foreground pt-2.5 w-5 text-right">{idx + 1}</span>
                  <div className="flex-1 space-y-1.5">
                    <Input placeholder="Bezeichnung" value={it.name || ''} onChange={(e) => upd(it._k, { name: e.target.value })} />
                    <Textarea placeholder="Beschreibung (optional)" rows={1} className="text-sm"
                      value={it.description || ''} onChange={(e) => upd(it._k, { description: e.target.value })} />
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => del(it._k)}><Trash2 className="w-4 h-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-2 pl-7">
                  <div className="w-20"><Label className="text-[10px] text-muted-foreground">Menge</Label>
                    <Input type="number" step="0.01" value={it.quantity ?? 1} onChange={(e) => upd(it._k, { quantity: Number(e.target.value) })} /></div>
                  <div className="w-24"><Label className="text-[10px] text-muted-foreground">Einheit</Label>
                    <Input value={it.unit || 'Stk'} onChange={(e) => upd(it._k, { unit: e.target.value })} /></div>
                  <div className="w-28"><Label className="text-[10px] text-muted-foreground">Einzelpreis €</Label>
                    <Input type="number" step="0.01" value={it.unit_price ?? 0} onChange={(e) => upd(it._k, { unit_price: Number(e.target.value) })} /></div>
                  <div className="w-20"><Label className="text-[10px] text-muted-foreground">USt %</Label>
                    <Input type="number" value={it.vat_rate ?? 20} onChange={(e) => upd(it._k, { vat_rate: Number(e.target.value) })} /></div>
                  <div className="w-20"><Label className="text-[10px] text-muted-foreground">Rabatt %</Label>
                    <Input type="number" value={it.discount_percent ?? 0} onChange={(e) => upd(it._k, { discount_percent: Number(e.target.value) })} /></div>
                  <div className="flex-1 min-w-[90px] text-right">
                    <Label className="text-[10px] text-muted-foreground">Netto</Label>
                    <div className="font-semibold pt-1.5">{eur(lineNet({
                      quantity: Number(it.quantity) || 0, unit_price: Number(it.unit_price) || 0,
                      discount_percent: Number(it.discount_percent) || 0, is_heading: false }))}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Summen */}
        <Card className="p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="w-32">
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><Percent className="w-3 h-3" /> Gesamtrabatt %</Label>
              <Input type="number" value={doc.discount_percent ?? 0} onChange={(e) => set({ discount_percent: Number(e.target.value) })} />
            </div>
            {kind === 'final_invoice' && (
              <>
                <div className="w-36"><Label className="text-xs text-muted-foreground">Anzahlungen netto</Label>
                  <Input type="number" step="0.01" value={doc.deducted_net ?? 0} onChange={(e) => set({ deducted_net: Number(e.target.value) })} /></div>
                <div className="w-36"><Label className="text-xs text-muted-foreground">davon USt</Label>
                  <Input type="number" step="0.01" value={doc.deducted_vat ?? 0} onChange={(e) => set({ deducted_vat: Number(e.target.value) })} /></div>
              </>
            )}
          </div>
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            {totals.byRate.map((g) => (
              <div key={g.rate} className="flex justify-between"><span className="text-muted-foreground">Netto {g.rate}%</span><span>{eur(g.net)}</span></div>
            ))}
            {Number(doc.deducted_net) > 0 && (
              <div className="flex justify-between text-muted-foreground"><span>abzgl. Anzahlungen</span><span>– {eur(Number(doc.deducted_net))}</span></div>
            )}
            {totals.byRate.map((g) => (
              <div key={'v' + g.rate} className="flex justify-between"><span className="text-muted-foreground">+ USt {g.rate}%</span><span>{eur(g.vat)}</span></div>
            ))}
            <div className="flex justify-between font-bold text-lg border-t pt-1"><span>Gesamt</span><span>{eur(totals.gross)}</span></div>
          </div>
        </Card>

        <Card className="p-4 mb-4">
          <Label className="text-xs text-muted-foreground">Schlusstext</Label>
          <Textarea rows={2} value={doc.outro_text || ''} onChange={(e) => set({ outro_text: e.target.value })} />
        </Card>

        {/* Folgebelege */}
        {!isNew && (
          <Card className="p-4 mb-4">
            <h3 className="font-semibold mb-2 text-sm">Weiter verarbeiten</h3>
            <div className="flex flex-wrap gap-2">
              {isOffer && (
                <>
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => createFollowUp('invoice')}>
                    <Receipt className="w-4 h-4" /> In Rechnung umwandeln
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => createFollowUp('partial_invoice', 50)}>
                    <FileText className="w-4 h-4" /> 50 % Anzahlungsrechnung
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => createFollowUp('final_invoice')}>
                    <FileText className="w-4 h-4" /> Schlussrechnung (mit Abzug)
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => createFollowUp(kind)}>
                <Copy className="w-4 h-4" /> Duplizieren
              </Button>
              {!isOffer && doc.status !== 'paid' && (
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => persist({ status: 'paid', paid_at: new Date().toISOString().slice(0, 10), paid_amount: totals.gross })}>
                  ✓ Als bezahlt markieren
                </Button>
              )}
            </div>
            {isOffer && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Anzahlung + Schlussrechnung: Die Schlussrechnung zieht bereits verrechnete Anzahlungen inkl. USt ab (§ 11 UStG).
              </p>
            )}
          </Card>
        )}
        </div>

        {/* Live-Vorschau – zeigt das echte PDF schon vor dem Speichern */}
        <aside className="hidden lg:block sticky top-20">
          <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> Live-Vorschau
          </div>
          <LivePreview
            doc={{ ...doc, net: totals.net, vat: totals.vat, gross: totals.gross }}
            items={items} settings={settings}
            className="h-[calc(100vh-220px)] min-h-[560px] bg-white shadow-sm"
          />
        </aside>
      </main>

      <Dialog open={mobilePreview} onOpenChange={setMobilePreview}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>Vorschau · {doc.number || DOC_KIND_LABEL[kind]}</DialogTitle></DialogHeader>
          <LivePreview doc={{ ...doc, net: totals.net, vat: totals.vat, gross: totals.gross }} items={items} settings={settings} className="flex-1" />
        </DialogContent>
      </Dialog>

      {/* Aktionsleiste */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-3">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-2">
          <div className="font-bold mr-auto">{eur(totals.gross)}</div>
          <Input className="w-full sm:w-56" placeholder="E-Mail-Empfänger" value={mailTo} onChange={(e) => setMailTo(e.target.value)} />
          <Button variant="outline" className="gap-1" disabled={busy} onClick={() => persist()}><Save className="w-4 h-4" /> Speichern</Button>
          <Button variant="outline" className="gap-1 lg:hidden" onClick={() => setMobilePreview(true)}><Eye className="w-4 h-4" /> Vorschau</Button>
          <Button variant="outline" className="gap-1" disabled={busy} onClick={downloadPdf}><Download className="w-4 h-4" /> PDF</Button>
          <Button className="gap-1" disabled={busy} onClick={sendMail}><Send className="w-4 h-4" /> Senden</Button>
        </div>
      </div>
    </div>
  );
}
