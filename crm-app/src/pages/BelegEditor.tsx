import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  useArticles, useCompanySettings, useCustomers, useDocument, naechsteRechnungsnummer, nextNumber, numberTaken, reserveNumber, saveDocument,
} from '@/hooks/useBilling';
import {
  DOC_KIND_LABEL, DOC_STATUS_LABEL, computeTotals, docInclVat, eur, fmtDate, lineAmount, customerLabel, openAmount, round2,
  type BillingDocument, type DocKind, type DocumentItem,
} from '@/types/billing';
import { buildDocumentPdf, documentFileName, epcQr } from '@/lib/documentPdf';
import { LivePreview } from '@/components/billing/LivePreview';
import { sendDocumentMail } from '@/lib/sendMail';
import { useAuftragVon } from '@/hooks/useAuftraege';
import { supabase } from '@/integrations/supabase/client';
import { ZahlungDialog } from '@/components/billing/ZahlungDialog';
import {
  Link2,
  ArrowLeft, Plus, Trash2, Download, Send, Star, Copy, FileText, Percent, Save, Receipt, Eye, Wallet, FileSignature,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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

  // Vorbereitete Anzahlungs-/Schlussrechnung: kommt ungespeichert herein und
  // wird erst mit „Speichern“ angelegt – dann bekommt sie auch ihre Nummer.
  const vorlage = (useLocation().state as { vorlage?: { doc: Partial<BillingDocument>; items: Partial<DocumentItem>[] } } | null)?.vorlage;
  const [doc, setDoc] = useState<Partial<BillingDocument>>(() => ({
    kind: (sp.get('kind') as DocKind) || 'offer',
    status: 'draft',
    doc_date: new Date().toISOString().slice(0, 10),
    discount_percent: 0, deducted_net: 0, deducted_vat: 0,
    ...(isNew && vorlage ? vorlage.doc : {}),
  }));
  const [items, setItems] = useState<Item[]>(() =>
    isNew && vorlage?.items.length ? vorlage.items.map((i) => ({ ...i, _k: key() })) : [emptyItem()]);
  const [custQ, setCustQ] = useState('');
  const [artQ, setArtQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mobilePreview, setMobilePreview] = useState(false);
  const [inlineIdx, setInlineIdx] = useState<string | null>(null); // Positions-Autocomplete
  const [numberEdited, setNumberEdited] = useState(false);         // Nummer selbst eingetippt?
  const [abrechnen, setAbrechnen] = useState<'anzahlung' | 'schluss' | null>(null); // Fenster „Auftrag abrechnen“
  const [teilBetrag, setTeilBetrag] = useState<number | ''>('');   // was jetzt verrechnet wird (netto)
  const [restAm, setRestAm] = useState('');                        // wann der Rest fällig wird
  const [zahlungOffen, setZahlungOffen] = useState(false);          // Zahlungs-Dialog
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
      const num = kind === 'offer' ? await nextNumber(kind, settings) : await naechsteRechnungsnummer(settings);
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

  // Was aus diesem Angebot schon entstanden ist – auch Entwürfe. Gibt es schon
  // einen Auftrag, gehört das Angebot dazu; hängt eine Rechnung an keinem
  // Auftrag, wäre jede weitere aus diesem Angebot doppelt verrechnet.
  const [folgebelege, setFolgebelege] = useState<{ id: string; number: string | null; kind: DocKind; status: string; projekt_id: string | null }[]>([]);
  useEffect(() => {
    if (doc.kind !== 'offer' || !doc.id) { setFolgebelege([]); return; }
    db.from('documents').select('id,number,kind,status,projekt_id').eq('source_document', doc.id)
      .neq('kind', 'offer').neq('status', 'cancelled').order('created_at')
      .then(({ data }: { data: typeof folgebelege | null }) => setFolgebelege(data || []));
  }, [doc.kind, doc.id]);
  const angebotsKette = folgebelege.find((f) => f.projekt_id)?.projekt_id ?? null;
  const loseFolge = folgebelege.filter((f) => !f.projekt_id);

  // Gehört dieser Beleg zu einem Auftrag, der in Teilen verrechnet wird?
  const { auftrag, reload: reloadAuftrag } = useAuftragVon(doc.projekt_id || angebotsKette);

  // Preisbasis: was am Beleg steht, schlägt die Firmeneinstellung
  const inclVat = docInclVat(doc, settings);

  const totals = useMemo(
    () => computeTotals(items.map((i) => ({
      quantity: Number(i.quantity) || 0, unit_price: Number(i.unit_price) || 0,
      discount_percent: Number(i.discount_percent) || 0, vat_rate: Number(i.vat_rate) || 0, is_heading: !!i.is_heading,
    })), Number(doc.discount_percent) || 0,
    { net: Number(doc.deducted_net) || 0, vat: Number(doc.deducted_vat) || 0 },
    inclVat),
    [items, doc.discount_percent, doc.deducted_net, doc.deducted_vat, inclVat],
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

  /** Vorlage direkt in die getippte Zeile übernehmen – oder Menge erhöhen, wenn schon vorhanden. */
  const applyArticleTo = (k: string, aId: string) => {
    const a = articles.find((x) => x.id === aId); if (!a) return;
    const dup = items.find((i) => i._k !== k && i.article_id === a.id);
    if (dup) {
      setItems((its) => its.filter((i) => i._k !== k).map((i) =>
        (i._k === dup._k ? { ...i, quantity: (Number(i.quantity) || 0) + 1 } : i)));
    } else {
      upd(k, { article_id: a.id, name: a.name, description: a.description || undefined,
        unit: a.unit, unit_price: Number(a.unit_price), vat_rate: Number(a.vat_rate) });
    }
    bump(a.id, a.use_count);
    setInlineIdx(null);
  };

  const upd = (k: string, p: Partial<Item>) => setItems((its) => its.map((i) => (i._k === k ? { ...i, ...p } : i)));
  const del = (k: string) => setItems((its) => (its.length > 1 ? its.filter((i) => i._k !== k) : [emptyItem()]));

  const persist = async (extra: Partial<BillingDocument> = {}) => {
    if (!user) return null;
    const merged = { ...doc, ...extra };
    const typed = (merged.number || '').trim();
    const offerDoc = ((merged.kind as DocKind) || 'offer') === 'offer';

    // Selbst eingetippte Nummern gegen den Bestand prüfen – zwei Belege mit
    // derselben Nummer wären ein Buchhaltungsfehler.
    if (typed && (numberEdited || !isNew) && (await numberTaken(typed, doc.id))) {
      toast.error(`Nummer ${typed} ist schon vergeben`);
      return null;
    }

    setBusy(true);
    if (isNew && !merged.number_locked) {
      if (offerDoc && numberEdited && typed) {
        // Frei gewählte Angebotsnummer: 1:1 übernehmen, der automatische
        // Zähler wird dafür NICHT weitergedreht.
        merged.number = typed; merged.number_locked = true;
        setDoc((d) => ({ ...d, number: typed, number_locked: true }));
      } else if (offerDoc) {
        // Verbindliche Nummer erst jetzt ziehen – Entwürfe reißen keine Lücke,
        // und zwei gleichzeitige Speichervorgänge bekommen nie dieselbe Nummer.
        const n = await reserveNumber('offer');
        if (n) { merged.number = n; merged.number_locked = true; setDoc((d) => ({ ...d, number: n, number_locked: true })); }
      } else {
        // Rechnungen laufen im Bestandsstil fortlaufend weiter (1423, 1424, …)
        const n = typed && !(await numberTaken(typed)) ? typed : await naechsteRechnungsnummer(settings);
        merged.number = n; merged.number_locked = true;
        setDoc((d) => ({ ...d, number: n, number_locked: true }));
      }
    }
    const newId = await saveDocument(merged, items.filter((i) => i.name || i.is_heading), user.id, inclVat);
    setBusy(false);
    if (!newId) return null;
    // Immer verknüpft: die erste Anzahlung wird selbst zur Auftragsklammer; jede
    // weitere Rechnung im Auftrag nimmt der vorigen die Rest-Erinnerung ab.
    if (merged.kind === 'partial_invoice' && !merged.projekt_id) {
      await setzeProjekt(newId, newId); setDoc((d) => ({ ...d, projekt_id: newId }));
    } else if (isNew && merged.projekt_id && (merged.kind === 'partial_invoice' || merged.kind === 'final_invoice')) {
      await db.from('documents').update({ rest_faellig_am: null }).eq('projekt_id', merged.projekt_id).neq('id', newId);
    }
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

  /**
   * Angebot → Rechnung (ganzer Betrag) oder Beleg duplizieren. Bereitet nur vor:
   * der neue Beleg öffnet sich ungespeichert – angelegt wird er samt Nummer erst
   * mit „Speichern“. In Teilen verrechnen: `anzahlungVorbereiten`.
   */
  const createFollowUp = async (kind: DocKind) => {
    if (!user) return;
    const srcId = doc.id || (await persist());
    if (!srcId) return;
    const today = new Date().toISOString().slice(0, 10);
    const newItems: Partial<DocumentItem>[] = items.filter((i) => i.name || i.is_heading)
      .map(({ id: _id, document_id: _d, ...i }) => i);
    navigate(`/beleg/neu?kind=${kind}`, { state: { vorlage: {
      doc: {
        kind, status: 'draft', doc_date: today,
        due_date: kind !== 'offer' ? addDays(today, settings?.default_payment_days || 14) : null,
        ...empfaenger(),
        source_document: srcId, parent_document_id: kind === 'offer' ? null : srcId,
        discount_percent: doc.discount_percent || 0, prices_include_vat: inclVat,
      },
      items: newItems,
    } } });
  };

  /** Klammer setzen – ohne sie gehören die Rechnungen nicht sichtbar zusammen. */
  const setzeProjekt = async (docId: string, projektId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { supabase } = await import('@/integrations/supabase/client') as any;
    await supabase.from('documents').update({ projekt_id: projektId }).eq('id', docId);
  };

  /** Empfänger und Texte für jede Folgerechnung – immer vom aktuellen Beleg. */
  const empfaenger = (): Partial<BillingDocument> => ({
    customer_id: doc.customer_id, lead_id: doc.lead_id,
    recipient_name: doc.recipient_name, recipient_company: doc.recipient_company,
    recipient_street: doc.recipient_street, recipient_zip: doc.recipient_zip,
    recipient_city: doc.recipient_city, recipient_country: doc.recipient_country,
    recipient_email: doc.recipient_email, recipient_uid: doc.recipient_uid,
    title: doc.title, intro_text: settings?.invoice_intro || '', outro_text: settings?.invoice_outro || '',
  });

  /** Bezug für den Rechnungstext: das Angebot und – falls vorhanden – der Vertrag dazu. */
  const bezugLaden = async (): Promise<string> => {
    let angebotId: string | null = isOffer ? (doc.id ?? null) : null;
    let angebotNr = isOffer ? (doc.number || '') : '';
    if (!angebotId && auftrag) {
      const { data: anker } = await db.from('documents').select('source_document').eq('id', auftrag.projektId).maybeSingle();
      if (anker?.source_document) {
        const { data: ang } = await db.from('documents').select('id,number,kind').eq('id', anker.source_document).maybeSingle();
        if (ang?.kind === 'offer') { angebotId = ang.id; angebotNr = ang.number || ''; }
      }
    }
    if (!angebotId) return '';
    const { data: vs } = await db.from('contracts').select('number,customer_signed_at,our_signed_at')
      .eq('document_id', angebotId).neq('status', 'draft').order('created_at', { ascending: false }).limit(1);
    const v = vs?.[0] as { number: string | null; customer_signed_at: string | null; our_signed_at: string | null } | undefined;
    if (!v?.number) return angebotNr ? `Angebot ${angebotNr}` : '';
    const vom = v.customer_signed_at || v.our_signed_at;
    return `Vertrag ${v.number}${vom ? ` vom ${fmtDate(vom.slice(0, 10))}` : ''}${angebotNr ? ` (Angebot ${angebotNr})` : ''}`;
  };

  /**
   * Anzahlungsrechnung – der einzige Weg, einen Auftrag in Teilen zu verrechnen.
   * Bereitet die Rechnung nur vor: sie öffnet sich als neuer, ungespeicherter
   * Beleg; angelegt (samt fortlaufender Nummer) wird sie erst mit „Speichern“.
   * Beim Speichern hängt `persist` sie an den Auftrag – die erste wird selbst
   * zur Klammer, jede weitere hängt an der bestehenden.
   */
  const anzahlungVorbereiten = async () => {
    const betrag = round2(Number(teilBetrag) || 0);
    if (!user || betrag <= 0) return;
    if (isOffer && !doc.id) { toast.error('Bitte das Angebot zuerst speichern.'); return; }
    const gesamt = auftrag ? auftrag.gesamt : totals.net;
    const offenVorher = auftrag ? auftrag.offen : totals.net;
    if (betrag > offenVorher + 0.005) { toast.error('Die Anzahlung ist größer als der noch offene Auftragswert.'); return; }
    const restDanach = round2(offenVorher - betrag);
    if (restDanach > 0.01 && !restAm) { toast.error('Bitte angeben, ab wann der Rest verrechnet wird.'); return; }
    setBusy(true);
    try {
      const bezug = await bezugLaden();
      const anteil = Math.round((betrag / gesamt) * 100);
      const vatSatz = items.find((i) => !i.is_heading)?.vat_rate ?? 20;
      const leistung = isOffer ? items.filter((i) => !i.is_heading && i.name).map((i) => i.name).slice(0, 6).join(', ') : '';
      const beschreibung = auftrag
        ? `Weitere Anzahlung laut ${bezug || `Auftrag über ${eur(gesamt)} netto`}`
        : `Anzahlung laut ${bezug || `${DOC_KIND_LABEL[kind]} ${doc.number || ''}`.trim()}${leistung ? ` für: ${leistung}` : ''}`;
      const pos: Partial<DocumentItem>[] = [{
        name: `${anteil} % Anzahlung`, description: beschreibung,
        quantity: 1, unit: 'Pauschal', unit_price: betrag, vat_rate: vatSatz, discount_percent: 0, is_heading: false,
      }];
      const kette: Partial<BillingDocument> = {
        kind: 'partial_invoice', project_total: gesamt, part_percent: anteil,
        rest_offen: restDanach > 0.01 ? restDanach : null,
        rest_faellig_am: restDanach > 0.01 ? restAm : null,
        discount_percent: 0, deducted_net: 0, deducted_vat: 0, deducted_note: null, prices_include_vat: false,
      };
      if (!isOffer && !auftrag) {
        // Rechnungsentwurf ohne Angebot: dieser Beleg wird zur Anzahlungsrechnung – übernommen erst mit „Speichern“.
        setDoc((d) => ({ ...d, ...kette }));
        setItems(pos.map((i) => ({ ...i, _k: key() })));
        toast.success('Als Anzahlungsrechnung vorbereitet – mit „Speichern“ übernehmen');
      } else {
        const today = new Date().toISOString().slice(0, 10);
        navigate('/beleg/neu?kind=partial_invoice', { state: { vorlage: {
          doc: {
            ...empfaenger(), ...kette, status: 'draft', doc_date: today,
            due_date: addDays(today, settings?.default_payment_days || 7),
            projekt_id: auftrag?.projektId ?? null,
            source_document: doc.id ?? null, parent_document_id: isOffer ? doc.id : null,
          },
          items: pos,
        } } });
      }
      setAbrechnen(null); setTeilBetrag(''); setRestAm('');
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  /**
   * Schlussrechnung vorbereiten: volle Leistung (die Positionen des Angebots,
   * sonst eine Gesamtposition) minus jede Anzahlung samt ihrer USt – je
   * Anzahlung eine Zeile mit Nummer und Datum (§ 11 UStG). Öffnet sich als
   * ungespeicherter Beleg; angelegt wird sie erst mit „Speichern“.
   */
  const schlussrechnungVorbereiten = async () => {
    if (!user || !auftrag) return;
    setBusy(true);
    try {
      const { data: kette } = await db.from('documents')
        .select('id,number,doc_date,net,vat,kind,status,source_document')
        .eq('projekt_id', auftrag.projektId).neq('status', 'cancelled').order('doc_date');
      const rows = (kette || []) as { id: string; number: string | null; doc_date: string; net: number; vat: number; kind: DocKind; source_document: string | null }[];
      if (rows.some((r) => r.kind === 'final_invoice')) throw new Error('Für diesen Auftrag gibt es schon eine Schlussrechnung.');
      const dNet = round2(rows.reduce((a, r) => a + Number(r.net || 0), 0));
      const dVat = round2(rows.reduce((a, r) => a + Number(r.vat || 0), 0));
      const note = rows.map((r) => `abzüglich ${DOC_KIND_LABEL[r.kind] || 'Rechnung'} ${r.number || ''} vom ${fmtDate(r.doc_date)}: `
        + `${eur(Number(r.net || 0))} netto + ${eur(Number(r.vat || 0))} USt`).join('\n');
      const bezug = await bezugLaden();

      // Volle Leistung: die Positionen des Angebots, wenn der Auftrag aus einem Angebot kommt
      const vatSatz = items.find((i) => !i.is_heading)?.vat_rate ?? 20;
      let pos: Partial<DocumentItem>[] = [{
        name: doc.title || 'Gesamtleistung',
        description: `Gesamtleistung laut ${bezug || `Auftrag über ${eur(auftrag.gesamt)} netto`}`,
        quantity: 1, unit: 'Pauschal', unit_price: auftrag.gesamt, vat_rate: vatSatz, discount_percent: 0, is_heading: false,
      }];
      let rabatt = 0;
      let brutto = false;
      const angebotId = rows.find((r) => r.id === auftrag.projektId)?.source_document;
      if (angebotId) {
        const { data: ang } = await db.from('documents').select('kind,discount_percent,prices_include_vat').eq('id', angebotId).maybeSingle();
        if (ang?.kind === 'offer') {
          const { data: its } = await db.from('document_items').select('*').eq('document_id', angebotId).order('position');
          const kopie = ((its || []) as DocumentItem[]).map(({ id: _id, document_id: _d, ...rest }) => rest);
          const r = Number(ang.discount_percent) || 0;
          // Nur übernehmen, wenn das Angebot noch genau den Auftragswert ergibt
          if (kopie.length && Math.abs(computeTotals(kopie, r, { net: 0, vat: 0 }, !!ang.prices_include_vat).net - auftrag.gesamt) < 0.02) {
            pos = [
              ...(bezug ? [{ name: `Leistung laut ${bezug}`, quantity: 0, unit: '', unit_price: 0, vat_rate: 0, discount_percent: 0, is_heading: true }] : []),
              ...kopie,
            ];
            rabatt = r; brutto = !!ang.prices_include_vat;
          }
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      navigate('/beleg/neu?kind=final_invoice', { state: { vorlage: {
        doc: {
          ...empfaenger(), kind: 'final_invoice', status: 'draft', doc_date: today,
          due_date: addDays(today, settings?.default_payment_days || 7),
          projekt_id: auftrag.projektId, project_total: auftrag.gesamt, rest_offen: null, rest_faellig_am: null,
          deducted_net: dNet, deducted_vat: dVat, deducted_note: note,
          discount_percent: rabatt, prices_include_vat: brutto,
          source_document: doc.id ?? null, parent_document_id: null,
        },
        items: pos,
      } } });
      setAbrechnen(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
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
          {isNew && !isOffer ? (
            <span className="text-sm text-muted-foreground" title="Die endgültige Nummer wird beim Speichern verbindlich vergeben">
              Vorschlag: <b>{doc.number || '…'}</b>
            </span>
          ) : (
            <>
              <Input className="h-8 w-44 font-semibold" value={doc.number || ''}
                onChange={(e) => { setNumberEdited(true); set({ number: e.target.value }); }}
                placeholder="Nummer"
                title={isNew ? 'Angebotsnummer frei wählbar – leer lassen für die nächste automatische Nummer'
                             : 'Laufende Nummer – änderbar'} />
              {isNew && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {numberEdited ? 'eigene Nummer' : 'Vorschlag – frei überschreibbar'}
                </span>
              )}
            </>
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
                    <div className="relative">
                      <Input placeholder="Bezeichnung – tippen für Vorlagen" value={it.name || ''}
                        onChange={(e) => { upd(it._k, { name: e.target.value, article_id: null }); setInlineIdx(e.target.value.trim().length >= 2 ? it._k : null); }}
                        onFocus={() => { if ((it.name || '').trim().length >= 2) setInlineIdx(it._k); }}
                        onBlur={() => setTimeout(() => setInlineIdx((cur) => (cur === it._k ? null : cur)), 150)} />
                      {inlineIdx === it._k && (() => {
                        const q = (it.name || '').toLowerCase();
                        const hits = articles.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 6);
                        return hits.length ? (
                          <div className="absolute z-30 left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg overflow-hidden">
                            {hits.map((a) => (
                              <button key={a.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between gap-2"
                                onMouseDown={(e) => { e.preventDefault(); applyArticleTo(it._k, a.id); }}>
                                <span className="truncate">{a.is_favorite ? '★ ' : ''}{a.name}</span>
                                <span className="text-muted-foreground shrink-0">{eur(Number(a.unit_price))} / {a.unit}</span>
                              </button>
                            ))}
                          </div>
                        ) : null;
                      })()}
                    </div>
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
                  <div className="w-28"><Label className="text-[10px] text-muted-foreground">{inclVat ? 'Preis brutto €' : 'Preis netto €'}</Label>
                    <Input type="number" step="0.01" value={it.unit_price ?? 0} onChange={(e) => upd(it._k, { unit_price: Number(e.target.value) })} /></div>
                  <div className="w-20"><Label className="text-[10px] text-muted-foreground">USt %</Label>
                    <Input type="number" value={it.vat_rate ?? 20} onChange={(e) => upd(it._k, { vat_rate: Number(e.target.value) })} /></div>
                  <div className="w-20"><Label className="text-[10px] text-muted-foreground">Rabatt %</Label>
                    <Input type="number" value={it.discount_percent ?? 0} onChange={(e) => upd(it._k, { discount_percent: Number(e.target.value) })} /></div>
                  <div className="flex-1 min-w-[90px] text-right">
                    <Label className="text-[10px] text-muted-foreground">{inclVat ? 'Brutto' : 'Netto'}</Label>
                    <div className="font-semibold pt-1.5">{eur(lineAmount({
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
            {/* Preisbasis nur für diesen Beleg – Altbelege bleiben unangetastet */}
            <div>
              <Label className="text-xs text-muted-foreground">Preise sind</Label>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant={inclVat ? 'secondary' : 'outline'}
                  onClick={() => set({ prices_include_vat: true })}
                  title="Positionspreise verstehen sich inklusive Umsatzsteuer">brutto</Button>
                <Button type="button" size="sm" variant={!inclVat ? 'secondary' : 'outline'}
                  onClick={() => set({ prices_include_vat: false })}
                  title="Positionspreise verstehen sich zuzüglich Umsatzsteuer">netto</Button>
              </div>
            </div>
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

        {/* Dieser Beleg gehört zu einem Auftrag, der in Teilen verrechnet wird – was offen ist, steht hier */}
        {auftrag && (
          <Card className="p-4 mb-4 border-l-4 border-l-primary">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-1.5">
                  <Link2 className="w-4 h-4 text-primary" /> Auftrag über {eur(auftrag.gesamt)} netto
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verrechnet {eur(auftrag.verrechnet)} ·{' '}
                  {auftrag.offen > 0.01
                    ? <span className="text-amber-700 font-medium">offen {eur(auftrag.offen)}</span>
                    : <span className="text-green-700 font-medium">vollständig verrechnet</span>}
                  {auftrag.offen > 0.01 && auftrag.restFaelligAm && ` · Rest vorgemerkt ab ${fmtDate(auftrag.restFaelligAm)}`}
                </p>
              </div>
              {auftrag.offen > 0.01 && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy}
                    onClick={() => { setTeilBetrag(''); setAbrechnen('anzahlung'); }}>
                    <Receipt className="w-4 h-4" /> Weitere Anzahlung
                  </Button>
                  <Button size="sm" className="gap-1" disabled={busy} onClick={() => setAbrechnen('schluss')}>
                    <Receipt className="w-4 h-4" /> Schlussrechnung
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-2 pt-2 border-t space-y-1">
              {auftrag.rechnungen.map((r) => (
                <div key={r.id} className={'flex justify-between text-xs ' + (r.id === doc.id ? 'font-semibold' : '')}>
                  <button className="hover:underline text-left" onClick={() => r.id !== doc.id && navigate(`/beleg/${r.id}`)}>
                    {DOC_KIND_LABEL[r.kind as DocKind] || 'Rechnung'} {r.number || 'ohne Nummer'} · {fmtDate(r.doc_date)}
                    {r.id === doc.id && ' (dieser Beleg)'}
                  </button>
                  <span>{eur(r.net)} netto</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Folgebelege */}
        {!isNew && (
          <Card className="p-4 mb-4">
            <h3 className="font-semibold mb-2 text-sm">Weiter verarbeiten</h3>
            <div className="flex flex-wrap gap-2">
              {isOffer && (
                <>
                  {/* Gibt es aus diesem Angebot schon eine Rechnung, darf keine zweite, unverbundene entstehen. */}
                  {folgebelege.length === 0 && (
                    <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => createFollowUp('invoice')}>
                      <Receipt className="w-4 h-4" /> In Rechnung umwandeln
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy || totals.net <= 0 || loseFolge.length > 0 || (!!auftrag && auftrag.offen <= 0.01)}
                    onClick={() => { setTeilBetrag(''); setAbrechnen('anzahlung'); }}>
                    <FileText className="w-4 h-4" /> Anzahlungsrechnung
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy}
                    onClick={async () => { const sid = doc.id || (await persist()); if (sid) navigate(`/vertrag/neu?angebot=${sid}`); }}>
                    <FileSignature className="w-4 h-4" /> Vertrag erstellen
                  </Button>

                </>
              )}
              {kind === 'invoice' && !doc.projekt_id && doc.status === 'draft' && totals.net > 0 && (
                <Button size="sm" variant="outline" className="gap-1" disabled={busy}
                  onClick={() => { setTeilBetrag(''); setAbrechnen('anzahlung'); }}>
                  <FileText className="w-4 h-4" /> Als Anzahlungsrechnung
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => createFollowUp(kind)}>
                <Copy className="w-4 h-4" /> Duplizieren
              </Button>
              {!isOffer && doc.status !== 'cancelled' && (
                <Button size="sm" variant={doc.status === 'paid' ? 'outline' : 'default'} className="gap-1" disabled={busy}
                  onClick={() => setZahlungOffen(true)}>
                  <Wallet className="w-4 h-4" />
                  {doc.status === 'paid' ? 'Zahlungen ansehen' : Number(doc.paid_amount) > 0 ? 'Weitere Zahlung erfassen' : 'Zahlung erfassen'}
                </Button>
              )}
            </div>
            {!isOffer && Number(doc.paid_amount) > 0 && (
              <p className="text-xs mt-2">
                <span className="text-green-700 font-medium">bezahlt {eur(Number(doc.paid_amount))}</span>
                {doc.status !== 'paid' && <> · <span className="text-amber-700 font-medium">offen {eur(openAmount(doc as BillingDocument))}</span></>}
                {doc.paid_at && <span className="text-muted-foreground"> · vollständig am {fmtDate(doc.paid_at)}</span>}
              </p>
            )}
            {isOffer && folgebelege.length > 0 && (
              <div className="text-xs mt-2 flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Aus diesem Angebot:</span>
                {folgebelege.map((f) => (
                  <button key={f.id} className="underline hover:no-underline" onClick={() => navigate(`/beleg/${f.id}`)}>
                    {DOC_KIND_LABEL[f.kind] || 'Rechnung'} {f.number || 'ohne Nummer'} ({DOC_STATUS_LABEL[f.status as keyof typeof DOC_STATUS_LABEL] || f.status})
                  </button>
                ))}
              </div>
            )}
            {isOffer && loseFolge.length > 0 && (
              <p className="text-xs mt-2 rounded-md bg-amber-50 text-amber-800 px-2.5 py-1.5">
                Zu diesem Angebot gibt es schon {loseFolge.map((f) => `${DOC_KIND_LABEL[f.kind] || 'Rechnung'} ${f.number || ''}`.trim()).join(', ')} ohne Auftrag.
                Bitte dort weitermachen oder den Entwurf löschen – sonst würde doppelt verrechnet.
              </p>
            )}
            {isOffer && (
              <p className="text-[11px] text-muted-foreground mt-2">
                In Teilen verrechnen: zuerst die Anzahlungsrechnung, der Rest wird vorgemerkt. Am Ende die Schlussrechnung –
                volle Leistung minus alle Anzahlungen samt USt (§ 11 UStG). Alles bleibt als ein Auftrag verknüpft.

              </p>
            )}
          </Card>
        )}
        {/* Auftrag abrechnen – erst „Rechnung erstellen“ legt die Rechnung samt Nummer an */}
        <Dialog open={!!abrechnen} onOpenChange={(o) => { if (!o) setAbrechnen(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{abrechnen === 'schluss' ? 'Schlussrechnung' : auftrag ? 'Weitere Anzahlung' : 'Anzahlungsrechnung'}</DialogTitle>
              <DialogDescription>Öffnet die Rechnung als Entwurf – angelegt wird sie samt Nummer erst mit „Speichern“.</DialogDescription>
            </DialogHeader>
            {(() => {
              const gesamt = auftrag ? auftrag.gesamt : totals.net;
              const offen = auftrag ? auftrag.offen : totals.net;
              const ust = (Number(items.find((i) => !i.is_heading)?.vat_rate ?? 20)) / 100;
              const brutto = (n: number) => eur(round2(n * (1 + ust)));
              const zeile = (label: string, n: number, cls = '') => (
                <div className={'flex justify-between gap-3 ' + cls}><span>{label}</span>
                  <span className="tabular-nums">{eur(n)} netto · {brutto(n)} brutto</span></div>
              );

              if (abrechnen === 'schluss' && auftrag) return (
                <div className="space-y-3 text-sm">
                  <div className="rounded-lg border p-3 space-y-1">
                    {zeile('Gesamtleistung', gesamt, 'font-medium')}
                    {auftrag.rechnungen.map((r) => (
                      <div key={r.id} className="flex justify-between gap-3 text-muted-foreground">
                        <span>abzüglich {DOC_KIND_LABEL[r.kind as DocKind] || 'Rechnung'} {r.number} vom {fmtDate(r.doc_date)}</span>
                        <span className="tabular-nums">– {eur(r.net)}</span>
                      </div>
                    ))}
                    {zeile('Zu zahlen', offen, 'font-bold border-t pt-1')}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Die Schlussrechnung zeigt die volle Leistung (Positionen des Angebots) und zieht jede Anzahlung samt ihrer USt ab.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setAbrechnen(null)}>Abbrechen</Button>
                    <Button className="gap-1" disabled={busy} onClick={schlussrechnungVorbereiten}><Receipt className="w-4 h-4" /> Rechnung erstellen</Button>
                  </div>
                </div>
              );

              const betrag = round2(Number(teilBetrag) || 0);
              const rest = round2(offen - betrag);
              const zuViel = betrag > offen + 0.005;
              return (
                <div className="space-y-3 text-sm">
                  <div className="rounded-lg border p-3 space-y-1">
                    {zeile('Gesamtauftrag', gesamt, 'font-medium')}
                    {auftrag && auftrag.verrechnet > 0 && zeile('bereits verrechnet', auftrag.verrechnet, 'text-muted-foreground')}
                    {auftrag && zeile('noch offen', offen)}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Anzahlung jetzt (netto)</Label>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <Input type="number" step="0.01" className="h-9 w-36" autoFocus
                        placeholder={String(Math.round(Math.min(offen, gesamt / 2)))}
                        value={teilBetrag} onChange={(e) => setTeilBetrag(e.target.value === '' ? '' : Number(e.target.value))} />
                      {[30, 50, 70].map((p) => (
                        <Button key={p} type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs"
                          disabled={round2(gesamt * p / 100) > offen + 0.005}
                          onClick={() => setTeilBetrag(round2(gesamt * p / 100))}>{p} %</Button>
                      ))}
                      {auftrag && (
                        <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setTeilBetrag(offen)}>ganzer Rest</Button>
                      )}
                    </div>
                  </div>
                  {betrag > 0 && rest > 0.01 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Rest {eur(rest)} netto verrechnen ab</Label>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <Input type="date" className="h-9 w-40" value={restAm} onChange={(e) => setRestAm(e.target.value)} />
                        {[1, 2, 3].map((m) => (
                          <Button key={m} type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => {
                            const d = new Date(); d.setMonth(d.getMonth() + m); setRestAm(d.toISOString().slice(0, 10));
                          }}>+{m} Mon.</Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {betrag > 0 && (
                    <div className={'rounded-lg p-2.5 text-xs ' + (zuViel ? 'bg-red-50 text-red-700' : 'bg-muted/50')}>
                      {zuViel ? `Mehr als der offene Auftragswert (${eur(offen)}).`
                        : <>Diese Rechnung: <b>{eur(betrag)} netto</b> + USt = <b>{brutto(betrag)}</b>
                          {rest > 0.01 ? <> · danach offen {eur(rest)} netto{restAm ? ` ab ${fmtDate(restAm)}` : ''}</> : ' · danach ist alles angezahlt'}</>}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setAbrechnen(null)}>Abbrechen</Button>
                    <Button className="gap-1" disabled={busy || betrag <= 0 || zuViel || (rest > 0.01 && !restAm)} onClick={anzahlungVorbereiten}>
                      <Receipt className="w-4 h-4" /> Rechnung erstellen
                    </Button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
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

      <ZahlungDialog doc={doc.id ? (doc as BillingDocument) : null} open={zahlungOffen}
        onOpenChange={setZahlungOffen} onChanged={reload} />

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
