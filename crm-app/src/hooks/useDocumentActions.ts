import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { buildDocumentPdf, documentFileName, epcQr } from '@/lib/documentPdf';
import { sendDocumentMail } from '@/lib/sendMail';
import type { BillingDocument, CompanySettings, DocumentItem } from '@/types/billing';
import { eur, fmtDate } from '@/types/billing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const addDays = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d: string, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x.toISOString().slice(0, 10); };

/**
 * Zahlung erfassen – auch Teilzahlungen. Status wird automatisch gesetzt:
 * voll bezahlt → 'paid', teilweise → 'partly_paid'.
 */
export async function addPayment(
  doc: BillingDocument,
  amount: number,
  on = new Date().toISOString().slice(0, 10),
  method = 'Überweisung',
): Promise<boolean> {
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  if (amt <= 0) { toast.error('Betrag fehlt'); return false; }
  const { error: pErr } = await db.from('payments')
    .insert({ user_id: doc.user_id, document_id: doc.id, amount: amt, paid_on: on, method });
  if (pErr) { toast.error('Zahlung konnte nicht gespeichert werden: ' + pErr.message); return false; }

  const paid = Math.round(((Number(doc.paid_amount) || 0) + amt) * 100) / 100;
  const full = paid >= Math.round(Number(doc.gross) * 100) / 100 - 0.01;
  const { error } = await db.from('documents').update({
    paid_amount: paid,
    status: full ? 'paid' : 'partly_paid',
    paid_at: full ? on : null,
    payment_method: method,
  }).eq('id', doc.id);
  if (error) { toast.error('Status konnte nicht gesetzt werden'); return false; }
  toast.success(full ? `${doc.number} vollständig bezahlt` : `Teilzahlung ${amt.toFixed(2)} € erfasst – offen: ${(Number(doc.gross) - paid).toFixed(2)} €`);
  return true;
}

/** Schnellaktion: komplette offene Restsumme als bezahlt buchen. */
export async function markPaid(doc: BillingDocument, on = new Date().toISOString().slice(0, 10)) {
  const rest = Math.round((Number(doc.gross) - (Number(doc.paid_amount) || 0)) * 100) / 100;
  return addPayment(doc, rest > 0 ? rest : Number(doc.gross), on);
}

/** Nächste freie Nummer im gleichen Kreis. */
async function nextNumberFor(doc: BillingDocument): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = (doc.number || 'RE-2026-0001').split('-')[0];
  const kinds = doc.kind === 'offer' ? ['offer'] : ['invoice', 'partial_invoice', 'final_invoice', 'credit_note'];
  const { data } = await db.from('documents').select('number').in('kind', kinds)
    .like('number', `${prefix}-${year}-%`).order('number', { ascending: false }).limit(1);
  const last = data?.[0]?.number as string | undefined;
  const n = last ? (parseInt(last.split('-').pop() || '0', 10) || 0) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

/**
 * Beleg für den Folgemonat wiederholen – für laufende Monatspauschalen
 * (Werbebetreuung, Social Media, Support …). Kopiert Empfänger + Positionen.
 */
export async function repeatForNextMonth(doc: BillingDocument, settings: CompanySettings | null): Promise<string | null> {
  const { data: items } = await db.from('document_items').select('*').eq('document_id', doc.id).order('position');
  const number = await nextNumberFor(doc);
  const today = new Date().toISOString().slice(0, 10);
  const payload: Partial<BillingDocument> = {
    user_id: doc.user_id, kind: doc.kind, number, status: 'draft',
    customer_id: doc.customer_id, lead_id: doc.lead_id,
    recipient_name: doc.recipient_name, recipient_company: doc.recipient_company,
    recipient_street: doc.recipient_street, recipient_zip: doc.recipient_zip,
    recipient_city: doc.recipient_city, recipient_country: doc.recipient_country,
    recipient_email: doc.recipient_email, recipient_uid: doc.recipient_uid,
    title: doc.title, intro_text: doc.intro_text, outro_text: doc.outro_text,
    doc_date: today,
    due_date: doc.kind !== 'offer' ? addDays(today, settings?.default_payment_days ?? 7) : null,
    service_date: doc.service_date ? addMonths(doc.service_date, 1) : null,
    discount_percent: doc.discount_percent, net: doc.net, vat: doc.vat, gross: doc.gross,
    source_document: doc.id,
  };
  const { data: created, error } = await db.from('documents').insert(payload).select('id').single();
  if (error) { toast.error('Wiederholen fehlgeschlagen'); return null; }
  const its = (items || []).map((i: DocumentItem) => ({
    document_id: created.id, position: i.position, article_id: i.article_id, name: i.name,
    description: i.description, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price,
    vat_rate: i.vat_rate, discount_percent: i.discount_percent, line_net: i.line_net, is_heading: i.is_heading,
  }));
  if (its.length) await db.from('document_items').insert(its);
  toast.success(`${number} für diesen Monat erstellt`);
  return created.id as string;
}

/** Zahlungserinnerung / Mahnung per Mail – mit Rechnung als PDF im Anhang. */
export async function sendReminder(
  doc: BillingDocument, settings: CompanySettings | null, level: 1 | 2 = 1,
): Promise<boolean> {
  const to = (doc.recipient_email || '').trim();
  if (!to) { toast.error('Keine E-Mail-Adresse beim Empfänger hinterlegt'); return false; }
  const { data: items } = await db.from('document_items').select('*').eq('document_id', doc.id).order('position');
  const qr = settings?.iban
    ? await epcQr({ name: settings.company_name || '', iban: settings.iban, bic: settings.bic || '',
        amount: Number(doc.gross), reference: doc.number || '' })
    : null;
  const pdf = buildDocumentPdf(doc, (items || []) as DocumentItem[], settings, qr);
  const base64 = pdf.output('datauristring').split(',')[1];

  const anrede = doc.recipient_company || doc.recipient_name || 'Damen und Herren';
  const text = level === 1
    ? `Guten Tag ${anrede},\n\nunsere Rechnung ${doc.number} vom ${fmtDate(doc.doc_date)} über ${eur(Number(doc.gross))} ist seit ${fmtDate(doc.due_date)} fällig und bei uns noch nicht eingelangt.\n\nVermutlich ist das nur übersehen worden – wir ersuchen höflich um Überweisung. Die Rechnung liegt nochmals bei.\n\nSollte die Zahlung bereits erfolgt sein, betrachten Sie dieses Schreiben bitte als gegenstandslos.\n\nBeste Grüße\n${settings?.company_name || 'ePower GmbH'}`
    : `Guten Tag ${anrede},\n\ntrotz unserer Zahlungserinnerung ist die Rechnung ${doc.number} vom ${fmtDate(doc.doc_date)} über ${eur(Number(doc.gross))} weiterhin offen.\n\nWir ersuchen um Überweisung binnen 7 Tagen. Die Rechnung liegt nochmals bei.\n\nBeste Grüße\n${settings?.company_name || 'ePower GmbH'}`;

  const ok = await sendDocumentMail({
    to,
    subject: level === 1
      ? `Zahlungserinnerung zu Rechnung ${doc.number}`
      : `2. Mahnung zu Rechnung ${doc.number}`,
    text,
    fileName: documentFileName(doc),
    pdfBase64: base64,
  });
  if (ok) {
    await db.from('documents').update({
      status: 'overdue',
      notes: `${doc.notes ? doc.notes + '\n' : ''}${level === 1 ? 'Zahlungserinnerung' : '2. Mahnung'} gesendet am ${fmtDate(new Date().toISOString())}`,
    }).eq('id', doc.id);
    toast.success(`${level === 1 ? 'Zahlungserinnerung' : 'Mahnung'} an ${to} gesendet`);
  }
  return ok;
}
