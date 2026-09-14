import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { buildDocumentPdf, documentFileName, epcQr } from '@/lib/documentPdf';
import { sendDocumentMail } from '@/lib/sendMail';
import type { BillingDocument, CompanySettings, DocumentItem, Payment } from '@/types/billing';
import { eur, fmtDate, openAmount } from '@/types/billing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const addDays = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d: string, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x.toISOString().slice(0, 10); };

/**
 * Zahlung erfassen – auch Teilzahlungen. Status wird automatisch gesetzt:
 * voll bezahlt → 'paid', teilweise → 'partly_paid'. Barzahlungen landen
 * zusätzlich im Kassabuch, weil sie dort ohnehin hingehören.
 */
export async function addPayment(
  doc: BillingDocument,
  amount: number,
  on = new Date().toISOString().slice(0, 10),
  method = 'Überweisung',
  note: string | null = null,
): Promise<boolean> {
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  if (amt <= 0) { toast.error('Betrag fehlt'); return false; }
  // Listen-Zeilen tragen nicht immer user_id – dann vom eingeloggten Nutzer nehmen.
  const userId = doc.user_id || (await supabase.auth.getUser()).data.user?.id;
  const { error: pErr } = await db.from('payments')
    .insert({ user_id: userId, document_id: doc.id, amount: amt, paid_on: on, method, note: note || null });
  if (pErr) { toast.error('Zahlung konnte nicht gespeichert werden: ' + pErr.message); return false; }

  if (method === 'Bar') {
    // Bareingang gehört ins Kassabuch – gleich mit Beleg-Bezug, damit der
    // Steuerberater die Zahlung der Rechnung zuordnen kann.
    const rate = Number(doc.net) > 0 && Number(doc.vat) >= 0 ? Math.round((Number(doc.vat) / Number(doc.net)) * 100) : 20;
    const net = Math.round((amt / (1 + rate / 100)) * 100) / 100;
    await db.from('cash_book').insert({
      user_id: userId, entry_date: on, direction: 'in', gross: amt, net,
      vat: Math.round((amt - net) * 100) / 100, vat_rate: rate,
      description: `Zahlung zu Rechnung ${doc.number || ''}`.trim() + (doc.recipient_company || doc.recipient_name ? ` – ${doc.recipient_company || doc.recipient_name}` : ''),
      receipt_no: doc.number, document_id: doc.id, payment_method: 'Bar',
    });
  }

  const ok = await recomputePaid(doc.id, on, method);
  if (!ok) return false;
  const paid = Math.round(((Number(doc.paid_amount) || 0) + amt) * 100) / 100;
  const full = paid >= Math.round(Number(doc.gross) * 100) / 100 - 0.01;
  toast.success(full ? `${doc.number} vollständig bezahlt` : `Teilzahlung ${eur(amt)} erfasst – offen: ${eur(Number(doc.gross) - paid)}`);
  return true;
}

/**
 * Bezahlt-Stand aus den Zahlungen neu ableiten. Die Zahlungen sind die
 * Wahrheit; paid_amount und Status am Beleg sind nur deren Abbild.
 */
async function recomputePaid(docId: string, lastOn?: string, lastMethod?: string): Promise<boolean> {
  const [{ data: pays }, { data: d }] = await Promise.all([
    db.from('payments').select('amount,paid_on,method').eq('document_id', docId).order('paid_on', { ascending: true }),
    db.from('documents').select('gross,status').eq('id', docId).single(),
  ]);
  if (!d) return false;
  const paid = Math.round(((pays || []) as Payment[]).reduce((a, p) => a + Number(p.amount || 0), 0) * 100) / 100;
  const full = paid >= Math.round(Number(d.gross) * 100) / 100 - 0.01;
  const last = ((pays || []) as Payment[]).at(-1);
  // Storniert bleibt storniert – auch wenn irgendwann Geld dazu gebucht wurde.
  const status = d.status === 'cancelled' ? 'cancelled'
    : full ? 'paid'
    : paid > 0 ? 'partly_paid'
    : ['paid', 'partly_paid'].includes(d.status) ? 'sent' : d.status; // ohne Zahlung: Zustand vor dem Geldeingang
  const { error } = await db.from('documents').update({
    paid_amount: paid, status,
    paid_at: full ? (lastOn || last?.paid_on || null) : null,
    payment_method: lastMethod || last?.method || null,
  }).eq('id', docId);
  if (error) { toast.error('Status konnte nicht gesetzt werden'); return false; }
  return true;
}

/** Zahlungen zu einem Beleg – älteste zuerst. */
export async function loadPayments(docId: string): Promise<Payment[]> {
  const { data } = await db.from('payments').select('*').eq('document_id', docId).order('paid_on', { ascending: true });
  return (data as Payment[]) || [];
}

/** Falsch erfasste Zahlung wieder entfernen – der Beleg wird danach neu berechnet. */
export async function removePayment(payment: Payment): Promise<boolean> {
  const { error } = await db.from('payments').delete().eq('id', payment.id);
  if (error) { toast.error('Zahlung konnte nicht entfernt werden'); return false; }
  // Der zugehörige Kassabuch-Eintrag geht mit – sonst stünde Geld in der Kassa, das nie kam.
  if (payment.method === 'Bar') {
    await db.from('cash_book').delete().eq('document_id', payment.document_id)
      .eq('entry_date', payment.paid_on).eq('gross', payment.amount).eq('payment_method', 'Bar');
  }
  const ok = await recomputePaid(payment.document_id);
  if (ok) toast.success('Zahlung entfernt');
  return ok;
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
    ? `Guten Tag ${anrede},\n\nunsere Rechnung ${doc.number} vom ${fmtDate(doc.doc_date)} über ${eur(Number(doc.gross))} ist seit ${fmtDate(doc.due_date)} fällig${Number(doc.paid_amount) > 0 ? ` – davon sind noch ${eur(openAmount(doc))} offen` : ' und bei uns noch nicht eingelangt'}.\n\nVermutlich ist das nur übersehen worden – wir ersuchen höflich um Überweisung. Die Rechnung liegt nochmals bei.\n\nSollte die Zahlung bereits erfolgt sein, betrachten Sie dieses Schreiben bitte als gegenstandslos.\n\nBeste Grüße\n${settings?.company_name || 'ePower GmbH'}`
    : `Guten Tag ${anrede},\n\ntrotz unserer Zahlungserinnerung ist die Rechnung ${doc.number} vom ${fmtDate(doc.doc_date)} ${Number(doc.paid_amount) > 0 ? `mit einem Restbetrag von ${eur(openAmount(doc))}` : `über ${eur(Number(doc.gross))}`} weiterhin offen.\n\nWir ersuchen um Überweisung binnen 7 Tagen. Die Rechnung liegt nochmals bei.\n\nBeste Grüße\n${settings?.company_name || 'ePower GmbH'}`;

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
