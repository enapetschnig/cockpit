// Benannter Import: funktioniert im Browser-Build wie im Node-Build gleichermassen.
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { BillingDocument, CompanySettings, DocumentItem } from '@/types/billing';
import { DOC_KIND_LABEL, computeTotals, docInclVat, lineAmount, round2 } from '@/types/billing';
import { EPOWER_LOGO } from './logoData';

/**
 * EPC-QR-Code (SEPA „Scan-to-Pay") – der Kunde scannt ihn mit seiner Banking-App
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

// ── Formatierung wie in den bisherigen Belegen (de-AT, Tausenderpunkt via Leerzeichen) ──
const money = (n: number) =>
  (Number(n) || 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTime = (d?: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}`;
};

/**
 * Erzeugt das Beleg-PDF im gewohnten Layout (1:1 wie die bisherigen
 * ePower-Rechnungen/Angebote aus HelloCash):
 * Logo links, Absender rechts, kleine Absenderzeile, Empfängerblock,
 * zentrierter Titel, Kopfzeile mit Beleg-Nr./Zahlungsart/Datum,
 * Positionstabelle (Anzahl · Beschreibung · USt % · Einzelpreis € · Gesamt €),
 * fette Summe, USt-Aufstellung, Hinweise, QR, Fußzeile mit Seitenzahl.
 */
export function buildDocumentPdf(
  doc: BillingDocument,
  items: DocumentItem[],
  s: CompanySettings | null,
  qrDataUrl?: string | null,
): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();   // 210
  const H = pdf.internal.pageSize.getHeight();  // 297
  const ML = 10;            // linker Rand wie im Original
  const MR = 12;            // rechter Rand
  const RX = W - MR;        // rechte Kante
  const BLACK: [number, number, number] = [0, 0, 0];
  const LINE: [number, number, number] = [150, 150, 150];
  const isOffer = doc.kind === 'offer';

  const setF = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => {
    pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(...BLACK);
  };
  const hr = (y: number, thick = 0.2) => {
    pdf.setDrawColor(...LINE); pdf.setLineWidth(thick); pdf.line(ML, y, RX, y);
  };

  // ── 1) Logo links ──
  try { pdf.addImage(EPOWER_LOGO, 'PNG', ML + 4, 8, 26, 26); } catch { /* Logo optional */ }

  // ── 2) Absender rechts (rechtsbündig) ──
  let y = 12;
  setF(11, 'bold'); pdf.text(s?.company_name || 'ePower GmbH', RX, y, { align: 'right' }); y += 4.6;
  setF(9);
  for (const l of [s?.street, [s?.postal_code, s?.city].filter(Boolean).join(' '), s?.country || 'Österreich'].filter(Boolean)) {
    pdf.text(String(l), RX, y, { align: 'right' }); y += 4.2;
  }
  y += 2.6;
  for (const l of [
    s?.uid_number ? `UID Nr.: ${s.uid_number}` : '',
    s?.firmenbuch ? `Firmenbuch Nr.: ${s.firmenbuch}` : '',
    s?.iban ? `IBAN: ${s.iban.replace(/\s/g, '')}` : '',
    s?.bic ? `BIC: ${s.bic}` : '',
  ].filter(Boolean)) {
    pdf.text(String(l), RX, y, { align: 'right' }); y += 4.2;
  }

  // ── 3) Kleine Absenderzeile über dem Empfänger ──
  let ly = 52;
  setF(6);
  pdf.text([s?.company_name, s?.street, [s?.postal_code, s?.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(' | '), ML, ly);
  ly += 6;

  // ── 4) Empfängerblock ──
  setF(10);
  for (const l of [
    doc.recipient_company,
    doc.recipient_name,
    doc.recipient_street,
    [doc.recipient_zip, doc.recipient_city].filter(Boolean).join(' '),
    doc.recipient_country && doc.recipient_country !== 'AT' && doc.recipient_country !== 'Österreich' ? doc.recipient_country : '',
    doc.recipient_uid ? `UID: ${doc.recipient_uid}` : '',
  ].filter(Boolean)) {
    pdf.text(String(l), ML, ly); ly += 4.6;
  }

  // ── 5) Zentrierter Titel ──
  let ty = Math.max(ly + 12, 86);
  setF(14, 'bold');
  pdf.text(isOffer ? 'Angebot' : (DOC_KIND_LABEL[doc.kind] || 'Rechnung'), W / 2, ty, { align: 'center' });
  ty += 12;

  // ── 6) Kopfzeile: Beleg-Nr. / Zahlungsart / Datum ──
  const cols = isOffer
    ? [{ l: 'Angebot Nr.', v: doc.number || '', x: ML },
       { l: 'Gültig bis', v: dateTime(doc.valid_until), x: ML + 60 },
       { l: 'Datum', v: dateTime(doc.doc_date), x: RX, align: 'right' as const }]
    : [{ l: 'Beleg Nr.', v: doc.number || '', x: ML },
       { l: 'Zahlungsart', v: doc.payment_method || 'Kreditrechnung', x: ML + 60 },
       { l: 'Fällig am', v: dateTime(doc.due_date), x: ML + 120 },
       { l: 'Datum', v: dateTime(doc.doc_date), x: RX, align: 'right' as const }];
  setF(9);
  cols.forEach((c) => pdf.text(c.l, c.x, ty, c.align ? { align: c.align } : undefined));
  ty += 4.6;
  setF(9, 'bold');
  cols.forEach((c) => pdf.text(String(c.v), c.x, ty, c.align ? { align: c.align } : undefined));
  ty += 3.2;
  hr(ty); ty += 5;

  /**
   * Fließtext setzen. Zeilen ohne Kleinbuchstaben werden zu Abschnitts-
   * überschriften, „•" zu Aufzählungen – und der Text bricht sauber auf die
   * nächste Seite um, statt unten aus dem Blatt zu laufen.
   */
  const flow = (text: string, size = 9.5, lead = 4.8) => {
    const bottom = H - 26;
    const brk = () => { pdf.addPage(); ty = 25; };
    const zeilen = text.split('\n').map((l) => l.trim());
    const istUeberschrift = (l: string) => !/[a-zäöüß]/.test(l) && /[A-ZÄÖÜ]/.test(l) && l.length > 3;
    const umbruch = (l: string, breite: number) => pdf.splitTextToSize(l.replace(/^•\s*/, ''), breite) as string[];

    for (let i = 0; i < zeilen.length; i++) {
      const line = zeilen[i];
      if (!line) { ty += lead * 0.75; continue; }

      if (istUeberschrift(line)) {
        setF(size, 'bold');
        const kopf = umbruch(line, RX - ML);
        // Nächsten Absatz mitmessen, damit die Überschrift nie allein am Fuß steht.
        let n = i + 1; while (n < zeilen.length && !zeilen[n]) n++;
        const folge = n < zeilen.length && !istUeberschrift(zeilen[n])
          ? umbruch(zeilen[n], RX - ML - (zeilen[n].startsWith('•') ? 5 : 0)).length : 0;
        const brauche = lead * 0.8 + kopf.length * lead + 1.4 + Math.min(folge, 6) * lead;
        if (ty + brauche > bottom) brk(); else ty += lead * 0.8;
        for (const l of kopf) { pdf.text(l, ML, ty); ty += lead; }
        ty += 1.4;
        continue;
      }

      const bullet = line.startsWith('•');
      const x = bullet ? ML + 5 : ML;
      setF(size);
      const teile = umbruch(line, RX - x);
      // Kurze Absätze lieber ganz auf die neue Seite, statt einzelne Wörter zu vererben.
      const passt = Math.floor((bottom - ty) / lead);
      if (teile.length > passt && (teile.length <= 6 || passt < 2)) brk();
      teile.forEach((l, k) => {
        if (ty + lead > bottom) brk();
        if (bullet && k === 0) pdf.text('•', ML + 1, ty);
        pdf.text(l, x, ty); ty += lead;
      });
    }
  };

  // ── 6b) Anschreiben ──
  if (doc.intro_text?.trim()) { flow(doc.intro_text.trim()); ty += 5; }

  // ── 7) Positionstabelle ──
  const X_QTY = ML + 22;      // Anzahl (rechtsbündig)
  const X_DESC = ML + 28;     // Beschreibung
  const X_VAT = ML + 132;     // USt % (rechtsbündig)
  const X_PRICE = ML + 166;   // Einzelpreis (rechtsbündig)
  const X_SUM = RX;           // Gesamt (rechtsbündig)
  const DESC_W = X_VAT - X_DESC - 6;

  const header = () => {
    setF(9, 'bold');
    pdf.text('Anzahl', X_QTY, ty, { align: 'right' });
    pdf.text('Beschreibung', X_DESC, ty);
    pdf.text('USt %', X_VAT, ty, { align: 'right' });
    pdf.text('Einzelpreis €', X_PRICE, ty, { align: 'right' });
    pdf.text('Gesamt €', X_SUM, ty, { align: 'right' });
    ty += 2.6; hr(ty); ty += 5;
  };
  header();

  const inclVat = docInclVat(doc, s);
  const t = computeTotals(items, Number(doc.discount_percent) || 0,
    { net: Number(doc.deducted_net) || 0, vat: Number(doc.deducted_vat) || 0 }, inclVat);

  // Angebote bekommen etwas mehr Luft je Zeile – Rechnungen bleiben eng wie bisher.
  const ROW = isOffer ? 6.6 : 5.4;
  setF(9);
  for (const it of items) {
    if (ty > H - 55) { pdf.addPage(); ty = 25; header(); }
    if (it.is_heading) {
      setF(9, 'bold'); pdf.text(it.name, X_DESC, ty); setF(9); ty += isOffer ? 7.2 : 5.6; continue;
    }
    const line = lineAmount(it);
    const lines = pdf.splitTextToSize(it.name || '', DESC_W) as string[];
    pdf.text(String(Number(it.quantity) || 0).replace('.', ','), X_QTY, ty, { align: 'right' });
    pdf.text(lines[0] ?? '', X_DESC, ty);
    pdf.text(String(Number(it.vat_rate) || 0), X_VAT, ty, { align: 'right' });
    pdf.text(money(it.unit_price), X_PRICE, ty, { align: 'right' });
    pdf.text(money(line), X_SUM, ty, { align: 'right' });
    ty += ROW;
    for (const extra of lines.slice(1)) { pdf.text(extra, X_DESC, ty); ty += ROW; }
    if (it.description) {
      for (const dl of pdf.splitTextToSize(it.description, DESC_W) as string[]) {
        pdf.text(dl, X_DESC, ty); ty += ROW;
      }
    }
  }

  // ── 8) Summe ──
  // Brutto-Basis: eine große „Summe" – exakt wie in den bisherigen Belegen.
  // Netto-Basis: Zwischensumme netto hier, Gesamtbetrag erst nach der USt-Aufstellung.
  ty += 1;
  setF(14, 'bold');
  pdf.text(inclVat ? 'Summe' : 'Zwischensumme netto', ML, ty);
  pdf.text(`€ ${money(inclVat ? t.gross : t.net)}`, X_SUM, ty, { align: 'right' });
  ty += 4; hr(ty, 0.4); ty += 6;

  // ── 9) USt-Aufstellung ──
  setF(9, 'bold');
  pdf.text('USt %', ML, ty);
  pdf.text('Netto €', ML + 148, ty, { align: 'right' });
  pdf.text('Steuer €', ML + 172, ty, { align: 'right' });
  pdf.text('Brutto €', X_SUM, ty, { align: 'right' });
  ty += 5;
  setF(9, 'italic');
  for (const g of t.byRate) {
    pdf.text(String(g.rate), ML, ty);
    pdf.text(money(g.net), ML + 148, ty, { align: 'right' });
    pdf.text(money(g.vat), ML + 172, ty, { align: 'right' });
    pdf.text(money(round2(g.net + g.vat)), X_SUM, ty, { align: 'right' });
    ty += 5;
  }
  if (Number(doc.deducted_net) > 0) {
    setF(9);
    pdf.text(`abzüglich bereits verrechneter Anzahlungen: ${money(Number(doc.deducted_net))} netto / ${money(Number(doc.deducted_vat))} USt`, ML, ty + 1);
    ty += 6;
  }

  // Bei Netto-Basis steht der zahlbare Betrag erst hier – nach der USt-Aufstellung.
  if (!inclVat) {
    ty += 1;
    setF(14, 'bold');
    pdf.text('Gesamtbetrag', ML, ty);
    pdf.text(`€ ${money(t.gross)}`, X_SUM, ty, { align: 'right' });
    ty += 4; hr(ty, 0.4); ty += 2;
  }

  // ── 10) Hinweise + Zahlungstext (wie bisher) ──
  ty += 6;
  setF(9);
  if (!isOffer) {
    pdf.text('Lieferdatum = Rechnungsdatum', ML, ty); ty += 8;
    const tage = s?.default_payment_days ?? 7;
    const zahl = doc.outro_text?.trim()
      || `Bitte überweisen Sie den Rechnungsbetrag innerhalb von ${tage} Tagen an das Bankkonto rechts oben. `
       + `Beachten Sie bitte, dass der Empfängername auf "${s?.company_name || 'ePower GmbH'}" lautet und in der Zahlungsreferenz die Rechnungsnummer steht.`;
    for (const l of pdf.splitTextToSize(zahl, RX - ML) as string[]) { pdf.text(l, ML, ty); ty += 4.6; }
  } else {
    const outro = doc.outro_text?.trim();
    if (outro) { flow(outro); ty += 3; }
    // Die Gültigkeit steht am Schluss – mit konkretem Datum statt Fristangabe.
    if (doc.valid_until) {
      // Nur umbrechen, wenn die Zeile wirklich nicht mehr passt: sie braucht
      // rund 8 mm und muss über der Fußlinie (H − 18) bleiben. Die frühere
      // Reserve von 34 mm schob sie regelmäßig allein auf eine neue Seite.
      if (ty > H - 26) { pdf.addPage(); ty = 25; }
      setF(9.5, 'bold');
      pdf.text(`Dieses Angebot ist gültig bis ${dateTime(doc.valid_until)}.`, ML, ty + 2);
      ty += 8;
    }
  }
  if (s?.small_business) {
    setF(9, 'italic');
    pdf.text('Umsatzsteuerbefreit – Kleinunternehmerregelung gem. § 6 Abs. 1 Z 27 UStG.', ML, ty + 2);
    ty += 7;
  }

  // ── 11) QR mittig (wie bisher an dieser Stelle) ──
  if (qrDataUrl && !isOffer) {
    const q = 28;
    const qy = Math.min(ty + 8, H - 60);
    try { pdf.addImage(qrDataUrl, 'PNG', (W - q) / 2, qy, q, q); } catch { /* optional */ }
    setF(8);
    pdf.text('Scannen & bezahlen', W / 2, qy + q + 4, { align: 'center' });
  }

  // ── 12) Fußzeile mit Seitenzahl ──
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2);
    pdf.line(ML, H - 18, RX, H - 18);
    setF(8);
    pdf.text(`Seite ${p} / ${pages}`, W / 2, H - 13, { align: 'center' });
  }
  return pdf;
}

export function documentFileName(doc: BillingDocument): string {
  const label = (DOC_KIND_LABEL[doc.kind] || 'Beleg').replace(/\s/g, '_');
  return `${label}_${doc.number || doc.id.slice(0, 8)}.pdf`;
}
