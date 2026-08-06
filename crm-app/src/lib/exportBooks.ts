import JSZip from 'jszip';
import { supabase } from '@/integrations/supabase/client';
import { buildDocumentPdf, epcQr } from '@/lib/documentPdf';
import type { BillingDocument, CashBookEntry, CompanySettings, DocumentItem } from '@/types/billing';
import { DOC_KIND_LABEL, round2 } from '@/types/billing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface Period { from: string; to: string; label: string }

export const monthPeriod = (year: number, month: number): Period => {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 0).toISOString().slice(0, 10);
  return { from, to, label: `${String(month).padStart(2, '0')}-${year}` };
};
export const yearPeriod = (year: number): Period => ({ from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) });

const csvEsc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (n: unknown) => (Number(n) || 0).toFixed(2).replace('.', ',');
const dateDe = (d?: string | null) => (d ? new Date(d).toLocaleDateString('de-AT') : '');

export interface VatSummary {
  net: number; vat: number; gross: number; count: number;
  byRate: { rate: number; net: number; vat: number }[];
  cashIn: number; cashOut: number;
}

/** Belege + Positionen eines Zeitraums laden (ohne Angebote, ohne Stornos). */
export async function loadPeriod(p: Period): Promise<{ docs: BillingDocument[]; items: Record<string, DocumentItem[]>; cash: CashBookEntry[] }> {
  const { data: docs } = await db.from('documents').select('*')
    .in('kind', ['invoice', 'partial_invoice', 'final_invoice', 'credit_note'])
    .gte('doc_date', p.from).lte('doc_date', p.to)
    .order('doc_date', { ascending: true }).limit(2000);
  const list = ((docs as BillingDocument[]) || []).filter((d) => d.status !== 'cancelled');
  const ids = list.map((d) => d.id);
  const items: Record<string, DocumentItem[]> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('document_items').select('*').in('document_id', ids.slice(i, i + 200)).order('position');
    for (const it of ((data as DocumentItem[]) || [])) (items[it.document_id] ||= []).push(it);
  }
  const { data: cash } = await db.from('cash_book').select('*')
    .gte('entry_date', p.from).lte('entry_date', p.to).order('entry_date').limit(2000);
  return { docs: list, items, cash: ((cash as CashBookEntry[]) || []).filter((c) => !c.cancelled) };
}

/** UVA-taugliche Zusammenfassung: Entgelte je Steuersatz + geschuldete USt. */
export function summarize(docs: BillingDocument[], items: Record<string, DocumentItem[]>, cash: CashBookEntry[]): VatSummary {
  const rates = new Map<number, { net: number; vat: number }>();
  for (const d of docs) {
    const its = items[d.id] || [];
    const sign = d.kind === 'credit_note' ? -1 : 1;
    if (its.length) {
      for (const it of its) {
        if (it.is_heading) continue;
        const net = round2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0) * (1 - (Number(it.discount_percent) || 0) / 100)
          * (1 - (Number(d.discount_percent) || 0) / 100)) * sign;
        const r = Number(it.vat_rate) || 0;
        const cur = rates.get(r) || { net: 0, vat: 0 };
        cur.net = round2(cur.net + net); cur.vat = round2(cur.vat + net * r / 100);
        rates.set(r, cur);
      }
    } else {
      // Alt-Beleg ohne Positionen: aus Kopfsummen ableiten
      const net = round2(Number(d.net || 0)) * sign;
      const vat = round2(Number(d.vat || 0)) * sign;
      const r = net ? Math.round((vat / net) * 100) : 0;
      const cur = rates.get(r) || { net: 0, vat: 0 };
      cur.net = round2(cur.net + net); cur.vat = round2(cur.vat + vat);
      rates.set(r, cur);
    }
  }
  const byRate = [...rates.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, net: round2(v.net), vat: round2(v.vat) }));
  const net = round2(byRate.reduce((s, r) => s + r.net, 0));
  const vat = round2(byRate.reduce((s, r) => s + r.vat, 0));
  return {
    net, vat, gross: round2(net + vat), count: docs.length, byRate,
    cashIn: round2(cash.filter((c) => c.direction === 'in').reduce((a, c) => a + Number(c.gross || 0), 0)),
    cashOut: round2(cash.filter((c) => c.direction === 'out').reduce((a, c) => a + Number(c.gross || 0), 0)),
  };
}

/** Buchhaltungs-CSV (Semikolon, de-AT) – direkt für den Steuerberater. */
export function buildCsv(docs: BillingDocument[], items: Record<string, DocumentItem[]>): string {
  const head = ['Nummer', 'Datum', 'Belegart', 'Kunde', 'UID', 'Netto 20%', 'USt 20%', 'Netto 10%', 'USt 10%',
    'Netto 0%', 'Netto gesamt', 'USt gesamt', 'Brutto', 'Status', 'Bezahlt am', 'Zahlungsart'];
  const rows = docs.map((d) => {
    const its = items[d.id] || [];
    const per: Record<number, number> = {};
    if (its.length) {
      for (const it of its) {
        if (it.is_heading) continue;
        const n = round2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0) * (1 - (Number(it.discount_percent) || 0) / 100)
          * (1 - (Number(d.discount_percent) || 0) / 100));
        per[Number(it.vat_rate) || 0] = round2((per[Number(it.vat_rate) || 0] || 0) + n);
      }
    } else {
      const n = Number(d.net || 0); const v = Number(d.vat || 0);
      per[n ? Math.round((v / n) * 100) : 0] = n;
    }
    return [
      d.number, dateDe(d.doc_date), DOC_KIND_LABEL[d.kind] || d.kind,
      d.recipient_company || d.recipient_name || '', d.recipient_uid || '',
      num(per[20] || 0), num((per[20] || 0) * 0.2),
      num(per[10] || 0), num((per[10] || 0) * 0.1),
      num(per[0] || 0),
      num(d.net), num(d.vat), num(d.gross),
      d.status, dateDe(d.paid_at), d.payment_method || '',
    ];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvEsc).join(';')).join('\r\n');
}

export function buildCashCsv(cash: CashBookEntry[]): string {
  const head = ['Datum', 'Lfd. Nr.', 'Art', 'Brutto', 'Netto', 'USt', 'Beleg-Nr.', 'Beschreibung', 'Zahlungsart'];
  const rows = cash.map((c) => [dateDe(c.entry_date), c.seq_no ?? '', c.direction === 'in' ? 'Eingang' : 'Ausgang',
    num(c.gross), num(c.net), num(c.vat), c.receipt_no || '', c.description || '', c.payment_method || '']);
  return '﻿' + [head, ...rows].map((r) => r.map(csvEsc).join(';')).join('\r\n');
}

/**
 * Baut ein ZIP mit allen Rechnungs-PDFs des Zeitraums + Buchhaltungs-CSV +
 * Kassabuch-CSV + UVA-Zusammenfassung. Genau das, was der Steuerberater will.
 */
export async function buildExportZip(
  p: Period, settings: CompanySettings | null, onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const { docs, items, cash } = await loadPeriod(p);
  const sum = summarize(docs, items, cash);
  const zip = new JSZip();
  const folder = zip.folder(`Rechnungen_${p.label}`)!;

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    try {
      let qr: string | null = null;
      if (settings?.iban) {
        qr = await epcQr({ name: settings.company_name || '', iban: settings.iban, bic: settings.bic || '',
          amount: Number(d.gross) || 0, reference: d.number || '' });
      }
      const pdf = buildDocumentPdf(d, items[d.id] || [], settings, qr);
      const safe = (d.number || d.id.slice(0, 8)).replace(/[^\w.-]/g, '_');
      folder.file(`${safe}_${(d.recipient_company || d.recipient_name || 'Kunde').replace(/[^\w.-]/g, '_').slice(0, 40)}.pdf`,
        pdf.output('arraybuffer'));
    } catch { /* einzelner Beleg darf den Export nicht stoppen */ }
    onProgress?.(i + 1, docs.length);
  }

  zip.file(`Rechnungsjournal_${p.label}.csv`, buildCsv(docs, items));
  if (cash.length) zip.file(`Kassabuch_${p.label}.csv`, buildCashCsv(cash));

  const uva = [
    `Umsatzsteuer-Zusammenfassung ${p.label}`,
    `Zeitraum: ${dateDe(p.from)} bis ${dateDe(p.to)}`,
    `${settings?.company_name || ''}${settings?.uid_number ? ` · UID ${settings.uid_number}` : ''}`,
    '',
    `Belege: ${sum.count}`,
    ...sum.byRate.map((r) => `Entgelte ${r.rate}%: ${num(r.net)} EUR   USt: ${num(r.vat)} EUR`),
    '',
    `Netto gesamt:  ${num(sum.net)} EUR`,
    `USt gesamt:    ${num(sum.vat)} EUR`,
    `Brutto gesamt: ${num(sum.gross)} EUR`,
    '',
    `Kassabuch Eingänge: ${num(sum.cashIn)} EUR`,
    `Kassabuch Ausgänge: ${num(sum.cashOut)} EUR`,
    '',
    'Hinweis: Sollversteuerung (Ausstellungsdatum). Stornierte Belege sind nicht enthalten.',
  ].join('\r\n');
  zip.file(`UVA_Zusammenfassung_${p.label}.txt`, '﻿' + uva);

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
