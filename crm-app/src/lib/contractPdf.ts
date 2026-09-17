/**
 * Vertrags-PDF – gleiche Handschrift wie die Belege (Logo, Absender, Fußzeile),
 * dazu die Vertragsparteien nebeneinander, die Abschnitte und am Ende beide
 * Unterschriften als Bild mit Name, Ort und Zeitpunkt.
 */
import { jsPDF } from 'jspdf';
import { EPOWER_LOGO } from './logoData';
import type { Contract, VertragsText } from './vertrag';

const zeit = (iso?: string | null) => {
  if (!iso) return '';
  const x = new Date(iso);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}, ${p(x.getHours())}:${p(x.getMinutes())} Uhr`;
};

export function buildContractPdf(v: Contract, t: VertragsText): jsPDF {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const ML = 18, MR = 18, RX = W - MR, BOTTOM = H - 22;
  const setF = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => {
    pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(0, 0, 0);
  };
  const hr = (y: number) => { pdf.setDrawColor(150, 150, 150); pdf.setLineWidth(0.2); pdf.line(ML, y, RX, y); };

  let y = 0;
  const kopf = () => {
    try { pdf.addImage(EPOWER_LOGO, 'PNG', ML, 8, 22, 22); } catch { /* optional */ }
    setF(8); pdf.setTextColor(110, 110, 110);
    pdf.text(t.anbieter[0] || '', RX, 12, { align: 'right' });
    pdf.text(`${t.titel} · ${t.nummer}`, RX, 16.5, { align: 'right' });
    y = 40;
  };
  const neueSeite = () => { pdf.addPage(); kopf(); };
  const brauche = (mm: number) => { if (y + mm > BOTTOM) neueSeite(); };
  kopf();

  // ── Titel
  setF(16, 'bold'); pdf.text(t.titel, ML, y); y += 6.5;
  setF(9); pdf.setTextColor(90, 90, 90);
  pdf.text(`Vertrag Nr. ${t.nummer} · ${t.datum}`, ML, y); y += 9;

  // ── Parteien nebeneinander
  const colW = (RX - ML - 8) / 2;
  setF(8, 'bold'); pdf.setTextColor(90, 90, 90);
  pdf.text('AUFTRAGNEHMER', ML, y); pdf.text('AUFTRAGGEBER', ML + colW + 8, y); y += 4.5;
  setF(9.5);
  const links = t.anbieter, rechts = t.partner;
  const zeilen = Math.max(links.length, rechts.length);
  for (let i = 0; i < zeilen; i++) {
    if (links[i]) pdf.text(links[i], ML, y);
    if (rechts[i]) pdf.text(rechts[i], ML + colW + 8, y);
    y += 4.4;
  }
  y += 3; hr(y); y += 7;

  // ── Abschnitte
  for (const ab of t.abschnitte) {
    setF(10.5, 'bold');
    const body = pdf.splitTextToSize(ab.body, RX - ML) as string[];
    // Überschrift nie allein am Seitenende
    brauche(6 + Math.min(body.length, 3) * 4.6);
    pdf.text(ab.heading, ML, y); y += 5.5;
    setF(9.5);
    for (const l of body) { brauche(4.6); pdf.text(l, ML, y); y += 4.6; }
    y += 4.5;
  }

  // ── Unterschriften
  brauche(58);
  y += 2; hr(y); y += 8;
  setF(8, 'bold'); pdf.setTextColor(90, 90, 90);
  pdf.text('AUFTRAGNEHMER', ML, y); pdf.text('AUFTRAGGEBER', ML + colW + 8, y); y += 3;
  const sigH = 24, sigW = colW - 4;
  const box = (x: number, png: string | null, name: string | null, wann: string | null) => {
    if (png) { try { pdf.addImage(png, 'PNG', x, y, sigW, sigH); } catch { /* optional */ } }
    pdf.setDrawColor(60, 60, 60); pdf.setLineWidth(0.3); pdf.line(x, y + sigH + 1, x + sigW, y + sigH + 1);
    setF(9); pdf.setTextColor(0, 0, 0);
    pdf.text(name || (png ? '' : 'noch nicht unterschrieben'), x, y + sigH + 5.5);
    setF(7.5); pdf.setTextColor(110, 110, 110);
    if (wann) pdf.text(`elektronisch unterschrieben am ${zeit(wann)}`, x, y + sigH + 9.5);
  };
  box(ML, v.our_signature, v.our_signed_name || t.anbieter[0], v.our_signed_at);
  box(ML + colW + 8, v.customer_signature, v.customer_signed_name || t.partner[0], v.customer_signed_at);
  y += sigH + 14;

  if (v.text_hash) {
    setF(6.5); pdf.setTextColor(140, 140, 140);
    pdf.text(`Prüfsumme des Vertragstextes (SHA-256): ${v.text_hash}`, ML, y);
  }

  // ── Fußzeile
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    setF(7.5); pdf.setTextColor(120, 120, 120);
    pdf.setDrawColor(200, 200, 200); pdf.setLineWidth(0.2); pdf.line(ML, H - 14, RX, H - 14);
    pdf.text(`${t.anbieter[0] || ''} · Vertrag ${t.nummer}`, ML, H - 9);
    pdf.text(`Seite ${i} / ${n}`, RX, H - 9, { align: 'right' });
  }
  return pdf;
}

export const contractFileName = (v: Contract) =>
  `Vertrag_${(v.number || 'Entwurf').replace(/[^\w-]/g, '_')}_${(v.party_company || v.party_name || '').replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 40)}.pdf`;
