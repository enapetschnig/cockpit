// Buchhaltung: Angebote, Rechnungen (inkl. Teil-/Schlussrechnung), Kunden, Artikel, Kassabuch

export type DocKind = 'offer' | 'invoice' | 'partial_invoice' | 'final_invoice' | 'credit_note';
export type DocStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'paid' | 'partly_paid' | 'overdue' | 'cancelled';

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  offer: 'Angebot',
  invoice: 'Rechnung',
  partial_invoice: 'Anzahlungsrechnung',
  final_invoice: 'Schlussrechnung',
  credit_note: 'Gutschrift',
};

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  draft: 'Entwurf',
  sent: 'Versendet',
  accepted: 'Angenommen',
  rejected: 'Abgelehnt',
  paid: 'Bezahlt',
  partly_paid: 'Teilweise bezahlt',
  overdue: 'Überfällig',
  cancelled: 'Storniert',
};

export interface Customer {
  id: string;
  user_id: string;
  customer_no: string | null;
  company_name: string | null;
  salutation: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  house_no: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  uid_number: string | null;
  tax_number: string | null;
  notes: string | null;
  lead_id: string | null;
  source: string | null;
  created_at: string;
}

export interface Article {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  unit: string;
  unit_price: number;
  vat_rate: number;
  category: string | null;
  is_favorite: boolean;
  use_count: number;
  active: boolean;
}

export interface DocumentItem {
  id: string;
  document_id: string;
  position: number;
  article_id: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: number;
  discount_percent: number;
  line_net: number;
  is_heading: boolean;
}

export interface BillingDocument {
  id: string;
  user_id: string;
  kind: DocKind;
  number: string | null;
  status: DocStatus;
  customer_id: string | null;
  lead_id: string | null;
  recipient_name: string | null;
  recipient_company: string | null;
  recipient_street: string | null;
  recipient_zip: string | null;
  recipient_city: string | null;
  recipient_country: string | null;
  recipient_email: string | null;
  recipient_uid: string | null;
  title: string | null;
  intro_text: string | null;
  outro_text: string | null;
  doc_date: string;
  due_date: string | null;
  valid_until: string | null;
  service_date: string | null;
  net: number;
  vat: number;
  gross: number;
  discount_percent: number;
  paid_amount: number;
  paid_at: string | null;
  payment_method: string | null;
  sent_at: string | null;
  sent_to: string | null;
  converted_to: string | null;
  source_document: string | null;
  parent_document_id: string | null;
  project_total: number | null;
  part_percent: number | null;
  deducted_net: number;
  deducted_vat: number;
  pdf_url: string | null;
  pdf_path: string | null;
  legacy_source: string | null;
  legacy_ref: string | null;
  number_locked?: boolean;
  notes: string | null;
  created_at: string;
  items?: DocumentItem[];
}

export interface CompanySettings {
  id: string;
  user_id: string;
  company_name: string;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  uid_number: string | null;
  firmenbuch: string | null;
  gericht: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  logo_url: string | null;
  default_vat: number;
  default_payment_days: number;
  invoice_prefix: string;
  offer_prefix: string;
  next_invoice_no: number;
  next_offer_no: number;
  offer_valid_days: number;
  footer_text: string | null;
  offer_intro: string | null;
  offer_outro: string | null;
  invoice_intro: string | null;
  invoice_outro: string | null;
  small_business: boolean;
}

export interface CashBookEntry {
  id: string;
  user_id: string;
  entry_date: string;
  seq_no: number | null;
  direction: 'in' | 'out';
  gross: number;
  net: number | null;
  vat: number | null;
  vat_rate: number | null;
  description: string | null;
  receipt_no: string | null;
  document_id: string | null;
  payment_method: string | null;
  category: string | null;
  cancelled: boolean;
}

export interface ArchiveFile {
  id: string;
  user_id: string;
  file_name: string;
  storage_path: string;
  kind: string;
  period: string | null;
  doc_date: string | null;
  size_bytes: number | null;
}

// ── Rechnen (kaufmännisch gerundet, USt je Satz) ──────────────
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineNet(it: Pick<DocumentItem, 'quantity' | 'unit_price' | 'discount_percent' | 'is_heading'>): number {
  if (it.is_heading) return 0;
  const raw = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  return round2(raw * (1 - (Number(it.discount_percent) || 0) / 100));
}

export interface Totals {
  net: number;
  vat: number;
  gross: number;
  byRate: { rate: number; net: number; vat: number }[];
}

/** Summen inkl. Gesamtrabatt und (bei Schlussrechnung) Abzug bereits verrechneter Anzahlungen. */
export function computeTotals(
  items: Pick<DocumentItem, 'quantity' | 'unit_price' | 'discount_percent' | 'vat_rate' | 'is_heading'>[],
  discountPercent = 0,
  deduct: { net: number; vat: number } = { net: 0, vat: 0 },
): Totals {
  const groups = new Map<number, number>();
  for (const it of items) {
    if (it.is_heading) continue;
    const n = lineNet(it) * (1 - (discountPercent || 0) / 100);
    const rate = Number(it.vat_rate) || 0;
    groups.set(rate, round2((groups.get(rate) || 0) + n));
  }
  const byRate = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, net]) => ({ rate, net: round2(net), vat: round2(net * rate / 100) }));
  let net = round2(byRate.reduce((s, g) => s + g.net, 0));
  let vat = round2(byRate.reduce((s, g) => s + g.vat, 0));
  net = round2(net - (deduct.net || 0));
  vat = round2(vat - (deduct.vat || 0));
  return { net, vat, gross: round2(net + vat), byRate };
}

export const eur = (n: number) =>
  (Number(n) || 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });

export const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

export function customerLabel(c?: Partial<Customer> | null): string {
  if (!c) return '';
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return (c.company_name || person || '').trim() || '(ohne Namen)';
}
