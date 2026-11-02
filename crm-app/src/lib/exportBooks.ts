import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import { buildDocumentPdf, epcQr } from '@/lib/documentPdf';
import type { BillingDocument, CashBookEntry, CompanySettings, DocumentItem } from '@/types/billing';
import { DOC_KIND_LABEL, round2 } from '@/types/billing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface Period { from: string; to: string; label: string }

// Stornos des zuletzt geladenen Zeitraums (für transparente Ausweisung)
let cancelledInPeriod: BillingDocument[] = [];

export const monthPeriod = (year: number, month: number): Period => {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  // Letzter Tag ohne toISOString – das rechnet in UTC um und machte in Österreich aus dem 31. den 30.
  // (Rechnungen vom Monatsletzten fehlten so im Export, z. B. 1436–1438 vom 30.09.2026.)
  const to = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
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
  cancelledCount: number; cancelledSum: number;
  byRate: { rate: number; net: number; vat: number }[];
  cashIn: number; cashOut: number;
}

/** Belege + Positionen eines Zeitraums laden (ohne Angebote, ohne Stornos). */
export async function loadPeriod(p: Period): Promise<{ docs: BillingDocument[]; items: Record<string, DocumentItem[]>; cash: CashBookEntry[] }> {
  const { data: docs } = await db.from('documents').select('*')
    .in('kind', ['invoice', 'partial_invoice', 'final_invoice', 'credit_note'])
    .gte('doc_date', p.from).lte('doc_date', p.to)
    .order('doc_date', { ascending: true }).limit(2000);
  const all = (docs as BillingDocument[]) || [];
  const list = all.filter((d) => d.status !== 'cancelled');
  cancelledInPeriod = all.filter((d) => d.status === 'cancelled');
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

/**
 * Zerlegt einen Beleg in (Steuersatz → Netto)-Anteile.
 *
 * Die KOPFSUMMEN (net/vat) sind die Wahrheit – sie stammen aus dem
 * HelloCash-Import bzw. werden beim Speichern verbindlich berechnet.
 * Die Positionen dienen nur dazu, das Netto auf Steuersätze aufzuteilen –
 * und auch das nur, wenn ihre Summe die Kopfsumme trifft. Viele Altbelege
 * haben Positionen OHNE Preise; wer aus denen rechnet, landet bei 0 und
 * die USt-Zahllast bricht zusammen (so geschehen für Juli 2026).
 */
function steuerAnteile(d: BillingDocument, its: DocumentItem[]): { rate: number; net: number; vat: number }[] {
  const kopfNet = round2(Number(d.net || 0));
  const kopfVat = round2(Number(d.vat || 0));
  const zeilen = its.filter((i) => !i.is_heading);
  if (zeilen.length) {
    const per = new Map<number, number>();
    let summe = 0;
    for (const it of zeilen) {
      const n = round2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
        * (1 - (Number(it.discount_percent) || 0) / 100) * (1 - (Number(d.discount_percent) || 0) / 100));
      summe = round2(summe + n);
      const r = Number(it.vat_rate) || 0;
      per.set(r, round2((per.get(r) || 0) + n));
    }
    if (Math.abs(summe - kopfNet) < 0.06) {
      return [...per.entries()].map(([rate, net]) => ({ rate, net, vat: round2(net * rate / 100) }));
    }
  }
  // Positionen fehlen oder passen nicht zur Kopfsumme → ganzer Beleg auf den
  // abgeleiteten Satz (bei 0-Netto-Belegen schlicht 0 %).
  const rate = kopfNet ? Math.round((kopfVat / kopfNet) * 100) : 0;
  return [{ rate, net: kopfNet, vat: kopfVat }];
}

/** UVA-taugliche Zusammenfassung: Entgelte je Steuersatz + geschuldete USt. */
export function summarize(docs: BillingDocument[], items: Record<string, DocumentItem[]>, cash: CashBookEntry[]): VatSummary {
  const rates = new Map<number, { net: number; vat: number }>();
  for (const d of docs) {
    const sign = d.kind === 'credit_note' ? -1 : 1;
    for (const teil of steuerAnteile(d, items[d.id] || [])) {
      const cur = rates.get(teil.rate) || { net: 0, vat: 0 };
      cur.net = round2(cur.net + sign * teil.net);
      cur.vat = round2(cur.vat + sign * teil.vat);
      rates.set(teil.rate, cur);
    }
  }
  const byRate = [...rates.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, net: round2(v.net), vat: round2(v.vat) }));
  const net = round2(byRate.reduce((s, r) => s + r.net, 0));
  const vat = round2(byRate.reduce((s, r) => s + r.vat, 0));
  return {
    net, vat, gross: round2(net + vat), count: docs.length, byRate,
    cancelledCount: cancelledInPeriod.length,
    cancelledSum: round2(cancelledInPeriod.reduce((a, d) => a + Number(d.gross || 0), 0)),
    cashIn: round2(cash.filter((c) => c.direction === 'in').reduce((a, c) => a + Number(c.gross || 0), 0)),
    cashOut: round2(cash.filter((c) => c.direction === 'out').reduce((a, c) => a + Number(c.gross || 0), 0)),
  };
}

/** Buchhaltungs-CSV (Semikolon, de-AT) – direkt für den Steuerberater. */
export function buildCsv(docs: BillingDocument[], items: Record<string, DocumentItem[]>): string {
  const head = ['Nummer', 'Datum', 'Belegart', 'Kunde', 'UID', 'Netto 20%', 'USt 20%', 'Netto 10%', 'USt 10%',
    'Netto 0%', 'Netto gesamt', 'USt gesamt', 'Brutto', 'Status', 'Bezahlt am', 'Zahlungsart'];
  const rows = docs.map((d) => {
    const per: Record<number, number> = {};
    for (const teil of steuerAnteile(d, items[d.id] || [])) {
      per[teil.rate] = round2((per[teil.rate] || 0) + teil.net);
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
    ...(sum.cancelledCount ? [`Stornierte Belege (nicht gerechnet): ${sum.cancelledCount} über ${num(sum.cancelledSum)} EUR`] : []),
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

/**
 * Alle Rechnungen des Zeitraums in EINEM PDF für den Steuerberater:
 * vorne eine Übersicht (Rechnungsjournal + USt je Satz), dahinter jede Rechnung
 * im gewohnten Layout. Stornos wie im ZIP nicht enthalten, aber auf der Übersicht erwähnt.
 */
export async function buildMonthPdf(
  p: Period, settings: CompanySettings | null, onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const { docs, items, cash } = await loadPeriod(p);
  const sum = summarize(docs, items, cash);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const H = pdf.internal.pageSize.getHeight();
  const eurDe = (n: unknown) => `${num(n)} €`;

  // Übersicht
  let y = 18;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
  pdf.text(`Rechnungen ${p.label}`, 14, y); y += 6;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
  pdf.text(`${settings?.company_name || ''}${settings?.uid_number ? ` · UID ${settings.uid_number}` : ''} · Zeitraum ${dateDe(p.from)} bis ${dateDe(p.to)}`, 14, y);
  y += 9;
  const spalten = [14, 30, 52, 128, 150, 172]; // Nr, Datum, Kunde, Netto, USt, Brutto (rechtsbündig ab 128)
  const kopf = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.text('Nr.', spalten[0], y); pdf.text('Datum', spalten[1], y); pdf.text('Kunde', spalten[2], y);
    pdf.text('Netto', 146, y, { align: 'right' }); pdf.text('USt', 168, y, { align: 'right' }); pdf.text('Brutto', 196, y, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    y += 2; pdf.line(14, y, 196, y); y += 5;
  };
  kopf();
  for (const d of docs) {
    if (y > H - 20) { pdf.addPage(); y = 18; kopf(); }
    const sign = d.kind === 'credit_note' ? -1 : 1;
    const kunde = (d.recipient_company || d.recipient_name || '').slice(0, 44) + (d.kind === 'credit_note' ? ' (Gutschrift)' : '');
    pdf.text(d.number || '', spalten[0], y); pdf.text(dateDe(d.doc_date), spalten[1], y); pdf.text(kunde, spalten[2], y);
    pdf.text(eurDe(sign * Number(d.net || 0)), 146, y, { align: 'right' });
    pdf.text(eurDe(sign * Number(d.vat || 0)), 168, y, { align: 'right' });
    pdf.text(eurDe(sign * Number(d.gross || 0)), 196, y, { align: 'right' });
    y += 5;
  }
  if (y > H - 50) { pdf.addPage(); y = 18; }
  pdf.line(14, y - 2, 196, y - 2); y += 3;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Summe (${sum.count} Belege)`, spalten[2], y);
  pdf.text(eurDe(sum.net), 146, y, { align: 'right' }); pdf.text(eurDe(sum.vat), 168, y, { align: 'right' }); pdf.text(eurDe(sum.gross), 196, y, { align: 'right' });
  pdf.setFont('helvetica', 'normal'); y += 9;
  for (const r of sum.byRate) { pdf.text(`Entgelte ${r.rate} %: ${eurDe(r.net)}   USt: ${eurDe(r.vat)}`, 14, y); y += 5; }
  if (sum.cancelledCount) { y += 2; pdf.text(`Stornierte Belege (nicht enthalten): ${sum.cancelledCount} über ${eurDe(sum.cancelledSum)}`, 14, y); y += 5; }
  y += 2;
  pdf.setFontSize(8);
  pdf.text('Sollversteuerung (Ausstellungsdatum). Die einzelnen Rechnungen folgen auf den nächsten Seiten.', 14, y);

  // Rechnungen dahinter
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    try {
      let qr: string | null = null;
      if (settings?.iban) {
        qr = await epcQr({ name: settings.company_name || '', iban: settings.iban, bic: settings.bic || '',
          amount: Number(d.gross) || 0, reference: d.number || '' });
      }
      buildDocumentPdf(d, items[d.id] || [], settings, qr, pdf);
    } catch { /* einzelner Beleg darf den Export nicht stoppen */ }
    onProgress?.(i + 1, docs.length);
  }
  return pdf.output('blob');
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
