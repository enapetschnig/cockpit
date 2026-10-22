import { jsPDF } from 'jspdf';
import type { BillingDocument, CompanySettings, DocumentItem } from '@/types/billing';
import { buildDocumentPdf, documentFileName, epcQr } from './documentPdf';
import { EPOWER_LOGO } from './logoData';

/**
 * Mahnwesen: Zahlungserinnerung / Mahnung als PDF im gewohnten Briefkopf –
 * Christoph lädt sie herunter und verschickt sie selbst (das CRM mailt nichts).
 * Auf Wunsch hängt die Rechnung gleich hinten dran (eine Datei).
 */

export type MahnStufe = 1 | 2 | 3;
export const STUFE_TITEL: Record<MahnStufe, string> = { 1: 'Zahlungserinnerung', 2: 'Mahnung', 3: 'Letzte Mahnung' };

const geld = (n: number) => (Number(n) || 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const datum = (d?: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}`;
};
const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const mitWochentag = (d: string) => `${WOCHENTAG[new Date(d).getDay()]}, ${datum(d)}`;

/** Vorschlag für den Brieftext – im Dialog frei änderbar. */
export function mahnText(doc: BillingDocument, o: { stufe: MahnStufe; frist: string; offen: number; sperre: boolean; wasSperren: string; absender: string; firma: string }): string {
  const name = (doc.recipient_name || '').replace(/^(Herrn|Herr|Frau)\s+/i, '').trim();
  const anrede = /^(Herrn|Herr)\b/i.test(doc.recipient_name || '') ? `Sehr geehrter Herr ${name.split(' ').pop()},`
    : /^Frau\b/i.test(doc.recipient_name || '') ? `Sehr geehrte Frau ${name.split(' ').pop()},`
    : 'Sehr geehrte Damen und Herren,';
  const teilweise = Number(doc.paid_amount) > 0;
  const betrag = teilweise ? `den offenen Restbetrag von ${geld(o.offen)} EUR` : `den Betrag von ${geld(o.offen)} EUR`;
  const rechnung = `unsere Rechnung ${doc.number} vom ${datum(doc.doc_date)} über ${geld(Number(doc.gross))} EUR`;
  const frist = mitWochentag(o.frist);
  const sperre = o.sperre
    ? `\n\nSollte die Zahlung bis dahin nicht eingegangen sein, müssen wir ${o.wasSperren || 'den Zugang zur Software'} bis zum Zahlungseingang leider deaktivieren. Das Nutzungsrecht an der Software besteht erst mit vollständiger Bezahlung.`
    : '';
  const gruss = `\n\nMit freundlichen Grüßen\n${o.absender}\n${o.firma}`;

  if (o.stufe === 1) {
    return `${anrede}\n\n${rechnung} war am ${datum(doc.due_date)} fällig${teilweise ? `; offen sind noch ${geld(o.offen)} EUR` : ' und ist bei uns noch nicht eingelangt'}. `
      + `Vermutlich ist das nur untergegangen – wir ersuchen höflich um Überweisung bis ${frist} (Zahlungsreferenz: ${doc.number}).${sperre}`
      + `\n\nSollte die Zahlung bereits erfolgt sein, betrachten Sie dieses Schreiben bitte als gegenstandslos.${gruss}`;
  }
  if (o.stufe === 2) {
    return `${anrede}\n\n${rechnung} war bereits am ${datum(doc.due_date)} fällig und ist trotz Fälligkeit bis heute nicht bezahlt.`
      + `\n\nWir ersuchen Sie, ${betrag} bis spätestens ${frist} auf unser Konto zu überweisen (Zahlungsreferenz: ${doc.number}).${sperre}`
      + `\n\nSollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.${gruss}`;
  }
  return `${anrede}\n\ntrotz unserer bisherigen Erinnerungen ist ${rechnung} (fällig seit ${datum(doc.due_date)}) weiterhin offen.`
    + `\n\nWir fordern Sie hiermit letztmalig auf, ${betrag} bis spätestens ${frist} zu überweisen (Zahlungsreferenz: ${doc.number}).${sperre}`
    + `\n\nNach Ablauf dieser Frist übergeben wir die Forderung ohne weitere Ankündigung zur Eintreibung; die dadurch entstehenden Kosten gehen zu Ihren Lasten.${gruss}`;
}

export async function buildMahnungPdf(
  doc: BillingDocument, items: DocumentItem[], s: CompanySettings | null,
  o: { stufe: MahnStufe; datum: string; frist: string; offen: number; text: string; rechnungAnhaengen: boolean },
): Promise<jsPDF> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const ML = 10, MR = 12, RX = W - MR;
  const LINE: [number, number, number] = [150, 150, 150];
  const setF = (size: number, style: 'normal' | 'bold' = 'normal') => { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(0, 0, 0); };
  const hr = (y: number) => { pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(ML, y, RX, y); };

  // Briefkopf wie auf den Rechnungen
  try { pdf.addImage(EPOWER_LOGO, 'PNG', ML + 4, 8, 26, 26); } catch { /* Logo optional */ }
  let y = 12;
  setF(11, 'bold'); pdf.text(s?.company_name || 'ePower GmbH', RX, y, { align: 'right' }); y += 4.6;
  setF(9);
  for (const l of [s?.street, [s?.postal_code, s?.city].filter(Boolean).join(' '), s?.country || 'Österreich'].filter(Boolean)) { pdf.text(String(l), RX, y, { align: 'right' }); y += 4.2; }
  y += 2.6;
  for (const l of [s?.uid_number ? `UID Nr.: ${s.uid_number}` : '', s?.firmenbuch ? `Firmenbuch Nr.: ${s.firmenbuch}` : '',
    s?.iban ? `IBAN: ${s.iban.replace(/\s/g, '')}` : '', s?.bic ? `BIC: ${s.bic}` : ''].filter(Boolean)) { pdf.text(String(l), RX, y, { align: 'right' }); y += 4.2; }

  let ly = 52;
  setF(6);
  pdf.text([s?.company_name, s?.street, [s?.postal_code, s?.city].filter(Boolean).join(' ')].filter(Boolean).join(' | '), ML, ly);
  ly += 6;
  setF(10);
  for (const l of [doc.recipient_company, doc.recipient_name, doc.recipient_street, [doc.recipient_zip, doc.recipient_city].filter(Boolean).join(' '),
    doc.recipient_uid ? `UID: ${doc.recipient_uid}` : ''].filter(Boolean)) { pdf.text(String(l), ML, ly); ly += 4.6; }

  let ty = Math.max(ly + 12, 86);
  setF(14, 'bold');
  pdf.text(STUFE_TITEL[o.stufe], W / 2, ty, { align: 'center' });
  ty += 12;

  // Kopfzeile: worum es geht und bis wann
  const cols = [
    { l: 'Rechnung Nr.', v: doc.number || '', x: ML },
    { l: 'Rechnungsdatum', v: datum(doc.doc_date), x: ML + 45 },
    { l: 'Fällig seit', v: datum(doc.due_date), x: ML + 95 },
    { l: 'Zahlbar bis', v: datum(o.frist), x: ML + 140 },
    { l: 'Datum', v: datum(o.datum), x: RX, align: 'right' as const },
  ];
  setF(9);
  cols.forEach((c) => pdf.text(c.l, c.x, ty, c.align ? { align: c.align } : undefined));
  ty += 4.6;
  setF(9, 'bold');
  cols.forEach((c) => pdf.text(String(c.v), c.x, ty, c.align ? { align: c.align } : undefined));
  ty += 3.2; hr(ty); ty += 7;

  // Brieftext
  setF(10);
  for (const absatz of o.text.split('\n')) {
    if (!absatz.trim()) { ty += 3; continue; }
    for (const z of pdf.splitTextToSize(absatz, RX - ML) as string[]) {
      if (ty > H - 30) { pdf.addPage(); ty = 25; }
      pdf.text(z, ML, ty); ty += 5;
    }
  }

  // Offener Betrag – fett, damit er nicht übersehen wird
  ty += 6;
  hr(ty); ty += 6;
  setF(10);
  pdf.text(`Rechnungsbetrag ${doc.number}`, ML, ty); pdf.text(`€ ${geld(Number(doc.gross))}`, RX, ty, { align: 'right' }); ty += 5;
  if (Number(doc.paid_amount) > 0) { pdf.text('bereits bezahlt', ML, ty); pdf.text(`- € ${geld(Number(doc.paid_amount))}`, RX, ty, { align: 'right' }); ty += 5; }
  setF(11, 'bold');
  pdf.text('Offener Betrag', ML, ty + 1); pdf.text(`€ ${geld(o.offen)}`, RX, ty + 1, { align: 'right' });
  ty += 8;

  // Zahlungs-QR über den offenen Betrag
  const qr = s?.iban ? await epcQr({ name: s.company_name || '', iban: s.iban, bic: s.bic || '', amount: o.offen, reference: doc.number || '' }) : null;
  if (qr && ty < H - 60) {
    try { pdf.addImage(qr, 'PNG', (W - 32) / 2, ty + 4, 32, 32); } catch { /* optional */ }
    setF(8); pdf.text('Scannen & bezahlen', W / 2, ty + 40, { align: 'center' });
  }

  const briefSeiten = pdf.getNumberOfPages();
  for (let p = 1; p <= briefSeiten; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(ML, H - 18, RX, H - 18);
    setF(8); pdf.text(`${STUFE_TITEL[o.stufe]} zu Rechnung ${doc.number}`, W / 2, H - 13, { align: 'center' });
  }
  pdf.setPage(briefSeiten);

  if (o.rechnungAnhaengen) {
    const rqr = s?.iban ? await epcQr({ name: s.company_name || '', iban: s.iban, bic: s.bic || '', amount: Number(doc.gross), reference: doc.number || '' }) : null;
    buildDocumentPdf(doc, items, s, rqr, pdf);
  }
  return pdf;
}

export const mahnungDateiname = (doc: BillingDocument, stufe: MahnStufe) =>
  `${STUFE_TITEL[stufe].replace(/\s/g, '_')}_${doc.number || doc.id.slice(0, 8)}.pdf`;

export { documentFileName };
