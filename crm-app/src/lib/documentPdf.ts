import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import autoTable from 'jspdf-autotable';
import type { BillingDocument, CompanySettings, DocumentItem } from '@/types/billing';
import { DOC_KIND_LABEL, computeTotals, eur, fmtDate } from '@/types/billing';

/**
 * EPC-QR-Code (SEPA "Scan-to-Pay") – der Kunde scannt ihn mit seiner Banking-App
 * und die Überweisung ist fertig ausgefüllt. Standard: EPC069-12.
 */
export async function epcQr(opts: { name: string; iban: string; bic?: string; amount: number; reference: string }): Promise<string | null> {
  const iban = (opts.iban || '').replace(/\s/g, '');
  if (!iban || !opts.amount) return null;
  const payload = [
    'BCD', '002', '1', 'SCT',
    (opts.bic || '').replace(/\s/g, ''),
    (opts.name || '').slice(0, 70),
    iban,
    `EUR${opts.amount.toFixed(2)}`,
    '', '',
    (opts.reference || '').slice(0, 140),
    '',
  ].join('\n');
  try {
    return await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 0, width: 240 });
  } catch { return null; }
}

/**
 * Erzeugt ein österreichisch konformes Beleg-PDF.
 * Pflichtangaben lt. § 11 UStG: Name+Anschrift liefernd/leistend & Empfänger, Menge/Art der Leistung,
 * Leistungszeitraum, Entgelt je Steuersatz, Steuersatz + Steuerbetrag, Ausstellungsdatum,
 * fortlaufende Nummer, UID des Ausstellers (ab 10.000 € auch UID des Empfängers).
 * Bei Schlussrechnungen werden bereits verrechnete Anzahlungen inkl. USt abgezogen.
 */
export function buildDocumentPdf(
  doc: BillingDocument,
  items: DocumentItem[],
  s: CompanySettings | null,
  qrDataUrl?: string | null,
): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 20;
  const W = pdf.internal.pageSize.getWidth();
  const kindLabel = DOC_KIND_LABEL[doc.kind] || 'Beleg';
  const ink = [28, 27, 25] as [number, number, number];
  const sub = [110, 105, 98] as [number, number, number];

  // ── Kopf: Absender ──
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...ink);
  pdf.text(s?.company_name || 'ePower GmbH', M, 24);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...sub);
  const senderLines = [
    [s?.street, s?.postal_code && s?.city ? `${s.postal_code} ${s.city}` : s?.city].filter(Boolean).join(' · '),
    [s?.phone, s?.email, s?.website].filter(Boolean).join(' · '),
    [s?.uid_number ? `UID: ${s.uid_number}` : '', s?.firmenbuch ? `FN ${s.firmenbuch}` : ''].filter(Boolean).join(' · '),
  ].filter(Boolean) as string[];
  senderLines.forEach((l, i) => pdf.text(l, M, 30 + i * 4.2));

  // ── Empfänger ──
  let y = 52;
  pdf.setFontSize(8); pdf.setTextColor(...sub);
  pdf.text('Rechnungsempfänger', M, y); y += 5;
  pdf.setFontSize(10.5); pdf.setTextColor(...ink); pdf.setFont('helvetica', 'bold');
  pdf.text(doc.recipient_company || doc.recipient_name || '', M, y); y += 5;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  const rec = [
    doc.recipient_company && doc.recipient_name ? doc.recipient_name : '',
    doc.recipient_street || '',
    [doc.recipient_zip, doc.recipient_city].filter(Boolean).join(' '),
    doc.recipient_country && doc.recipient_country !== 'AT' ? doc.recipient_country : '',
    doc.recipient_uid ? `UID: ${doc.recipient_uid}` : '',
  ].filter(Boolean);
  rec.forEach((l) => { pdf.text(l, M, y); y += 5; });

  // ── Belegkopf rechts ──
  const rx = W - M;
  let ry = 52;
  const meta: [string, string][] = [
    [`${kindLabel}snummer`.replace('Angebotsnummer', 'Angebotsnummer'), doc.number || '—'],
    ['Datum', fmtDate(doc.doc_date)],
  ];
  if (doc.kind === 'offer' && doc.valid_until) meta.push(['Gültig bis', fmtDate(doc.valid_until)]);
  if (doc.kind !== 'offer' && doc.due_date) meta.push(['Fällig am', fmtDate(doc.due_date)]);
  if (doc.service_date) meta.push(['Leistungsdatum', fmtDate(doc.service_date)]);
  pdf.setFontSize(9);
  meta.forEach(([k, v]) => {
    pdf.setTextColor(...sub); pdf.text(k, rx - 42, ry, { align: 'left' });
    pdf.setTextColor(...ink); pdf.setFont('helvetica', 'bold'); pdf.text(v, rx, ry, { align: 'right' });
    pdf.setFont('helvetica', 'normal'); ry += 5;
  });

  // ── Titel ──
  y = Math.max(y, ry) + 10;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.setTextColor(...ink);
  pdf.text(doc.title || kindLabel, M, y);
  y += 8;

  if (doc.intro_text) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...ink);
    const lines = pdf.splitTextToSize(doc.intro_text, W - 2 * M);
    pdf.text(lines, M, y); y += lines.length * 4.8 + 4;
  }

  // ── Positionen ──
  const body = items.map((it, i) => {
    if (it.is_heading) return [{ content: it.name, colSpan: 6, styles: { fontStyle: 'bold' as const, fillColor: [246, 244, 240] as [number, number, number] } }];
    const net = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) * (1 - (Number(it.discount_percent) || 0) / 100);
    return [
      String(i + 1),
      it.description ? `${it.name}\n${it.description}` : it.name,
      `${Number(it.quantity).toLocaleString('de-AT')} ${it.unit}`,
      eur(Number(it.unit_price)),
      `${Number(it.vat_rate)}%`,
      eur(net),
    ];
  });

  autoTable(pdf, {
    startY: y,
    head: [['Pos.', 'Bezeichnung', 'Menge', 'Einzelpreis', 'USt', 'Netto']],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: body as any,
    margin: { left: M, right: M },
    styles: { fontSize: 9, cellPadding: 2.5, textColor: ink, lineColor: [232, 228, 220], lineWidth: 0.1 },
    headStyles: { fillColor: [28, 27, 25], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 11, halign: 'center' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 26, halign: 'right' },
      4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 26, halign: 'right' },
    },
  });

  // ── Summen ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ty = ((pdf as any).lastAutoTable?.finalY || y) + 8;
  const t = computeTotals(items, Number(doc.discount_percent) || 0,
    { net: Number(doc.deducted_net) || 0, vat: Number(doc.deducted_vat) || 0 });
  const boxX = W - M - 78;
  const row = (label: string, val: string, bold = false, color = ink) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(bold ? 11 : 9.5); pdf.setTextColor(...color);
    pdf.text(label, boxX, ty); pdf.text(val, rx, ty, { align: 'right' });
    ty += bold ? 6.5 : 5.2;
  };
  if (doc.discount_percent > 0) row(`Rabatt ${doc.discount_percent}%`, '', false, sub);
  t.byRate.forEach((g) => row(`Nettobetrag ${g.rate}%`, eur(g.net)));
  if (Number(doc.deducted_net) > 0) row('abzügl. Anzahlungen (netto)', '– ' + eur(Number(doc.deducted_net)), false, sub);
  t.byRate.forEach((g) => row(`+ USt ${g.rate}%`, eur(g.vat)));
  if (Number(doc.deducted_vat) > 0) row('abzügl. USt Anzahlungen', '– ' + eur(Number(doc.deducted_vat)), false, sub);
  pdf.setDrawColor(232, 228, 220); pdf.line(boxX, ty - 2, rx, ty - 2); ty += 3;
  row(doc.kind === 'offer' ? 'Gesamtbetrag' : 'Rechnungsbetrag', eur(t.gross), true);

  if (s?.small_business) {
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8.5); pdf.setTextColor(...sub);
    pdf.text('Umsatzsteuerbefreit – Kleinunternehmerregelung gem. § 6 Abs. 1 Z 27 UStG.', M, ty + 2);
    ty += 7;
  }

  // ── Schlusstext + Zahlungsinfo ──
  ty += 6;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...ink);
  if (doc.outro_text) {
    const lines = pdf.splitTextToSize(doc.outro_text, W - 2 * M);
    pdf.text(lines, M, ty); ty += lines.length * 4.6 + 3;
  }
  if (doc.kind !== 'offer' && (s?.iban || s?.bank_name)) {
    pdf.setFontSize(9); pdf.setTextColor(...sub);
    const pay = [
      s?.bank_name ? `Bank: ${s.bank_name}` : '',
      s?.iban ? `IBAN: ${s.iban}` : '',
      s?.bic ? `BIC: ${s.bic}` : '',
      doc.due_date ? `Zahlbar bis ${fmtDate(doc.due_date)}` : '',
      doc.number ? `Zahlungsreferenz: ${doc.number}` : '',
    ].filter(Boolean).join('   ·   ');
    const lines = pdf.splitTextToSize(pay, W - 2 * M);
    pdf.text(lines, M, ty); ty += lines.length * 4.4;
  }

  // ── Scan-to-Pay (EPC-QR) ──
  if (qrDataUrl && doc.kind !== 'offer') {
    const qs = 26;
    const qx = rx - qs;
    const qy = Math.min(ty + 2, pdf.internal.pageSize.getHeight() - 46);
    try { pdf.addImage(qrDataUrl, 'PNG', qx, qy, qs, qs); } catch { /* ignore */ }
    pdf.setFontSize(7); pdf.setTextColor(...sub);
    pdf.text('Scannen & bezahlen', qx + qs / 2, qy + qs + 3.5, { align: 'center' });
  }

  // ── Fußzeile auf allen Seiten ──
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    const fy = pdf.internal.pageSize.getHeight() - 12;
    pdf.setDrawColor(232, 228, 220); pdf.line(M, fy - 5, rx, fy - 5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...sub);
    const foot = [
      s?.company_name, [s?.street, s?.postal_code && s?.city ? `${s.postal_code} ${s.city}` : ''].filter(Boolean).join(', '),
      s?.uid_number ? `UID ${s.uid_number}` : '', s?.iban ? `IBAN ${s.iban}` : '',
    ].filter(Boolean).join('  ·  ');
    pdf.text(foot, M, fy);
    pdf.text(`Seite ${p} von ${pages}`, rx, fy, { align: 'right' });
  }
  return pdf;
}

export function documentFileName(doc: BillingDocument): string {
  const label = (DOC_KIND_LABEL[doc.kind] || 'Beleg').replace(/\s/g, '_');
  return `${label}_${doc.number || doc.id.slice(0, 8)}.pdf`;
}
