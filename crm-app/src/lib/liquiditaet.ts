/**
 * Liquiditätsplanung: Kontoauszüge einlesen, regelmäßige Zahlungen erkennen und den Kontostand
 * für die nächsten Monate vorausrechnen.
 *
 * Einlesen: Sparkassen-Auszug als PDF (Text-Layout „Buchungstext … Valuta … Betrag[-]“) oder
 * George-CSV (Girokonto und Kreditkarte, UTF-16LE, Spalten per Name). Startpunkt der Vorschau ist
 * immer der letzte Kontostand laut Auszug – nie eine Summe aus Umsätzen.
 *
 * Umsatzsteuer: Monat M wird am 15. von M+2 fällig. Bekannte Zahllasten kommen aus den Mails des
 * Steuerberaters (liq_steuer), alles danach wird geschätzt: USt aus den eigenen Rechnungen minus
 * durchschnittliche Vorsteuer (aus den bekannten Monaten zurückgerechnet).
 */

export type Konto = 'giro' | 'kreditkarte';

export interface LiqBuchung {
  konto: Konto;
  datum: string;          // YYYY-MM-DD
  betrag: number;         // Ausgabe negativ
  partner: string | null;
  text: string | null;
  quelle?: string;
  schluessel?: string;
}

export interface LiqAuszug { konto: Konto; stand_am: string; saldo: number; bezeichnung?: string | null }

export interface LiqPosten {
  id: string;
  gruppe: string;
  bezeichnung: string;
  betrag: number;
  intervall_monate: number;
  naechste_am: string;
  bis_am: string | null;
  privat: boolean;
  aktiv: boolean;
  muster: string | null;
  notiz: string | null;
}

export interface LiqSteuer {
  id: string;
  steuernummer: 'firma' | 'privat';
  faellig_am: string;
  u_monat: string | null;
  u_betrag: number | null;
  k_betrag: number | null;
  e_betrag: number | null;
  gesamt: number;
  notiz: string | null;
}

export interface RechnungLite {
  id: string;
  kind: string;
  status: string;
  number: string | null;
  recipient_company: string | null;
  recipient_name: string | null;
  gross: number;
  vat: number;
  paid_amount: number | null;
  doc_date: string | null;
  due_date: string | null;
  rest_offen: number | null;
  rest_faellig_am: string | null;
  projekt_id: string | null;
  source_document?: string | null;
  created_at: string;
}

/** Angenommenes Angebot (Auftrag gesichert). */
export interface AngebotLite { id: string; number: string | null; recipient_company: string | null; recipient_name: string | null; net: number; gross: number; status: string }
/** Wartungsvertrag: wird jährlich im Voraus verrechnet (WartungPage). */
export interface WartungLite { kunde: string; start_am: string | null; monatlich_netto: number; status: string; abgerechnet_bis: string | null }
/** Unterschriebener Software-Vertrag: Wartung beginnt nach der inkludierten Betreuung. */
export interface VertragLite { party_company: string | null; customer_signed_at: string | null; support_months: number | null; maintenance_monthly: number | null; document_id: string | null; status: string }

/* ── Hilfen ─────────────────────────────────────────────── */

const r2 = (n: number) => Math.round(n * 100) / 100;
export const zahl = (s: string): number => {
  const t = s.trim().replace(/\s/g, '');
  const neg = t.endsWith('-') || t.startsWith('-');
  const n = Number(t.replace(/-/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
};
const isoAusDe = (d: string) => { const [t, m, j] = d.split('.'); return `${j}-${m}-${t}`; };
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tagDazu = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
/** Gleicher Tag n Monate später (31. → Monatsende). */
export const monatDazu = (s: string, n: number) => {
  const d = new Date(s + 'T12:00:00');
  const tag = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const letzter = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(tag, letzter));
  return iso(d);
};
const monat = (s: string) => s.slice(0, 7);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Datei → Text: George liefert UTF-16LE mit BOM, sonst UTF-8. */
export function dateiText(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');
}

/* ── CSV (George: Girokonto oder Kreditkarte) ───────────── */

function csvZeilen(text: string): string[][] {
  const kopf = text.split(/\r?\n/, 1)[0] || '';
  const trenner = (kopf.match(/;/g)?.length || 0) > (kopf.match(/,/g)?.length || 0) ? ';' : ',';
  const zeilen: string[][] = [];
  let feld = '', zeile: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inQ = false; } else feld += c;
    } else if (c === '"') inQ = true;
    else if (c === trenner) { zeile.push(feld); feld = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      zeile.push(feld); feld = '';
      if (zeile.some((f) => f.trim())) zeilen.push(zeile);
      zeile = [];
    } else feld += c;
  }
  zeile.push(feld);
  if (zeile.some((f) => f.trim())) zeilen.push(zeile);
  return zeilen;
}

export function parseCsv(text: string): LiqBuchung[] {
  const [kopf, ...rest] = csvZeilen(text);
  if (!kopf) return [];
  const k = kopf.map((h) => h.trim().toLowerCase());
  const spalte = (...namen: string[]) => k.findIndex((h) => namen.some((n) => h === n || h.startsWith(n)));
  const iDatum = spalte('buchungsdatum', 'buchungstag', 'valuta', 'datum');
  const iBetrag = spalte('betrag', 'amount');
  const iPartner = spalte('partnername', 'empfänger', 'auftraggeber');
  const iDetails = spalte('buchungs-details', 'verwendungszweck', 'buchungstext', 'zahlungsreferenz');
  const iIban = spalte('eigene iban');
  if (iDatum < 0 || iBetrag < 0) throw new Error('CSV ohne Spalten „Buchungsdatum“ und „Betrag“');
  const out: LiqBuchung[] = [];
  for (const z of rest) {
    const d = (z[iDatum] || '').trim();
    const b = zahl(z[iBetrag] || '');
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(d) || !Number.isFinite(b)) continue;
    // Kreditkarten-Export hat keine eigene IBAN, der Giro-Export schon.
    const konto: Konto = iIban >= 0 && (z[iIban] || '').trim() ? 'giro' : 'kreditkarte';
    out.push({ konto, datum: isoAusDe(d), betrag: r2(b), partner: (z[iPartner] || '').trim() || null, text: (z[iDetails] || '').trim() || null, quelle: 'csv' });
  }
  return out;
}

/* ── PDF (Sparkasse-Kontoauszug) ────────────────────────── */

// Text … Valuta Betrag[-]; pdf.js trennt Spalten manchmal nur mit einem Leerzeichen → letztes Datum zählt
const BUCHUNG = /^(.*\S)\s+(\d{2}\.\d{2}\.\d{4})\s+([\d.]+,\d{2})(-?)\s*$/;
const RAUSCHEN = /^(AT\d{18}\s|IBAN\s|Steiermärkische|Aktiengesellschaft|Sparkassenplatz|\d{4} Graz|Buchungstext\/Booking|Kontoauszug|Account Statement)/;

/** Zeilen eines Sparkassen-Auszugs → Buchungen + Kontostand je Auszug. */
export function parseAuszugZeilen(zeilen: string[]): { buchungen: LiqBuchung[]; auszuege: LiqAuszug[] } {
  const buchungen: LiqBuchung[] = [];
  const auszuege: LiqAuszug[] = [];
  let akt: LiqAuszug | null = null;
  let letzte: LiqBuchung | null = null;
  let details: string[] = [];
  const letztGebucht = new Map<LiqAuszug, string>();
  const abschliessen = () => {
    if (letzte) {
      const p = details.find((d) => !/^MDID:/i.test(d) && d !== letzte!.text);
      letzte.partner = p || null;
    }
    letzte = null; details = [];
  };
  for (const roh of zeilen) {
    const z = roh.replace(/\s+$/, '');
    const nr = z.match(/Kontoauszug\s+Nr\.\s*(\d{3}\/\d{4})/);
    if (nr) {
      abschliessen();
      akt = { konto: 'giro', stand_am: '', saldo: NaN, bezeichnung: `Auszug ${nr[1]}` };
      auszuege.push(akt);
      continue;
    }
    const fuss = z.match(/^\s*AT\d{18}\s+(\d{2}\.\d{2}\.\d{4})/);
    if (fuss) { abschliessen(); if (akt && !akt.stand_am) akt.stand_am = isoAusDe(fuss[1]); continue; }
    const neu = z.match(/Neuer Kontostand(?:\/New Balance)?\s+([\d.]+,\d{2})(-?)/);
    if (neu) { abschliessen(); if (akt) akt.saldo = zahl(neu[1] + neu[2]); continue; }
    if (/Alter Kontostand|Gutschriften|Belastungen|Old Balance/.test(z)) continue;
    const m = z.match(BUCHUNG);
    if (m) {
      abschliessen();
      letzte = { konto: 'giro', datum: isoAusDe(m[2]), betrag: r2(zahl(m[3] + m[4])), partner: null, text: m[1].trim(), quelle: 'pdf' };
      buchungen.push(letzte);
      // Stand = Druckdatum des Auszugs, außer es liegt eine Buchung danach (Auszug über Monatsende gedruckt)
      if (akt && letzte.datum > (letztGebucht.get(akt) || '')) letztGebucht.set(akt, letzte.datum);
      continue;
    }
    const t = z.trim();
    if (!t || RAUSCHEN.test(t)) { if (RAUSCHEN.test(t)) abschliessen(); continue; }
    if (letzte) details.push(t);
  }
  abschliessen();
  for (const a of auszuege) { const g = letztGebucht.get(a); if (g && g > a.stand_am) a.stand_am = g; }
  return { buchungen, auszuege: auszuege.filter((a) => a.stand_am && Number.isFinite(a.saldo)) };
}

/** PDF im Browser lesen und die Textzeilen nach Position wieder zusammensetzen. */
export async function pdfZeilen(buf: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const inhalt = await page.getTextContent();
    const teile = (inhalt.items as { str: string; transform: number[]; width: number }[])
      .filter((i) => typeof i.str === 'string' && i.str.length)
      .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    const reihen: { y: number; t: typeof teile }[] = [];
    for (const t of teile) {
      const r = reihen.find((q) => Math.abs(q.y - t.y) < 2.5);
      if (r) r.t.push(t); else reihen.push({ y: t.y, t: [t] });
    }
    reihen.sort((a, b) => b.y - a.y);
    for (const r of reihen) {
      r.t.sort((a, b) => a.x - b.x);
      let zeile = '', ende = -1;
      for (const t of r.t) {
        if (ende >= 0) { const luecke = t.x - ende; zeile += luecke > 8 ? '    ' : luecke > 1.5 ? ' ' : ''; }
        zeile += t.s; ende = t.x + t.w;
      }
      out.push(zeile);
    }
  }
  return out;
}

/** Eindeutiger Schlüssel je Umsatz: gleiche Datei zweimal hochladen → nichts doppelt. */
export function schluesselVergeben(b: LiqBuchung[]): LiqBuchung[] {
  const zaehler = new Map<string, number>();
  return b.map((x) => {
    const basis = `${x.konto}|${x.datum}|${x.betrag.toFixed(2)}`;
    const n = (zaehler.get(basis) || 0) + 1;
    zaehler.set(basis, n);
    return { ...x, schluessel: `${basis}|${n}` };
  });
}

/* ── Muster erkennen ────────────────────────────────────── */

export interface Muster {
  key: string;
  bezeichnung: string;
  betrag: number;           // typischer Betrag (Median der letzten 3)
  tag: number;              // typischer Tag im Monat
  letzte_am: string;
  monate: number;           // in wie vielen der letzten 6 Monate
  schwankend: boolean;
  beispiel: string;         // Text für den Abgleich mit Posten-Mustern
}

const FINANZAMT = /finanzamt|fa österreich|fa71|712590355/i;
export const schlagwort = (b: Pick<LiqBuchung, 'partner' | 'text'>) => {
  // Kreditkartenabrechnung heißt im PDF „s Visa Card …“, in der CSV „Erste Bank“ – beides dieselbe Zahlung
  if (/kreditkartenrechnung/i.test(`${b.partner} ${b.text}`)) return 'kreditkartenrechnung';
  const roh = (b.partner && !/^\d+$/.test(b.partner.trim()) ? b.partner : b.text) || '';
  return roh.toLowerCase().replace(/mdid:\S*/g, '').replace(/[^a-zäöüß]+/g, ' ').trim().split(' ').filter((w) => w.length > 1).slice(0, 2).join(' ');
};
const bezeichnungVon = (b: LiqBuchung) => {
  const p = (b.partner || '').trim();
  // Aus dem Buchungstext nur die Wörter (ohne Nummern, Monate, Uhrzeiten): „Lohn 10/26“ → „Lohn“
  if (/kreditkartenrechnung/i.test(`${p} ${b.text}`)) return 'Kreditkartenabrechnung (Visa)';
  const t = (b.text || '').replace(/[\d/.,:?*()-]+/g, ' ').split(/\s+/).filter((w) => w.length > 1).join(' ');
  if (p && /[A-Za-zÄÖÜäöü]{4,}/.test(t) && t.length <= 30 && !t.toLowerCase().includes(p.toLowerCase().slice(0, 6))) return `${p} – ${t}`;
  return (p || t || (b.text || '')).split(/\s+/).filter((w) => w.length > 1).join(' ').slice(0, 60);
};
export const passtMuster = (muster: string | null, text: string) =>
  !!muster && muster.split('|').some((m) => m.trim() && text.toLowerCase().includes(m.trim().toLowerCase()));

/**
 * Regelmäßige Zahlungen am Girokonto: gleiche Gegenseite, ähnlicher Betrag (±25 %), in mindestens
 * 3 der letzten 6 Monate, höchstens ~1× pro Monat, zuletzt vor maximal 45 Tagen.
 * Klappt das nur ohne Betragsgruppe (z. B. Kreditkartenabrechnung), gilt es als „schwankend“.
 */
export function erkenneMuster(buchungen: LiqBuchung[], stichtag: string): Muster[] {
  const von = monatDazu(stichtag, -6);
  const giro = buchungen.filter((b) => b.konto === 'giro' && b.datum > von && b.datum <= stichtag
    && !FINANZAMT.test(`${b.partner} ${b.text}`));
  const gruppen = new Map<string, LiqBuchung[]>();
  for (const b of giro) {
    const k = `${b.betrag < 0 ? '-' : '+'}${schlagwort(b)}`;
    if (k.length < 3) continue;
    gruppen.set(k, [...(gruppen.get(k) || []), b]);
  }
  const ergebnis: Muster[] = [];
  const pruefe = (key: string, liste: LiqBuchung[], schwankend: boolean): boolean => {
    const ms = new Set(liste.map((b) => monat(b.datum)));
    const sortiert = [...liste].sort((a, b) => a.datum.localeCompare(b.datum));
    const letzte = sortiert[sortiert.length - 1];
    if (ms.size < 3 || liste.length / ms.size > 1.4 || letzte.datum < tagDazu(stichtag, -45)) return false;
    ergebnis.push({
      key, bezeichnung: bezeichnungVon(letzte), schwankend,
      betrag: r2(median(sortiert.slice(-3).map((b) => b.betrag))),
      tag: Math.round(median(sortiert.map((b) => Number(b.datum.slice(8))))),
      letzte_am: letzte.datum, monate: ms.size,
      beispiel: `${letzte.partner || ''} ${letzte.text || ''}`,
    });
    return true;
  };
  for (const [k, liste] of gruppen) {
    // Betragsgruppen: jeder Umsatz kommt zur ersten Gruppe, deren Median er auf ±25 % trifft.
    const cl: LiqBuchung[][] = [];
    for (const b of [...liste].sort((a, b) => a.betrag - b.betrag)) {
      const c = cl.find((g) => Math.abs(b.betrag - median(g.map((x) => x.betrag))) <= Math.abs(median(g.map((x) => x.betrag))) * 0.25);
      if (c) c.push(b); else cl.push([b]);
    }
    let gefunden = false;
    cl.forEach((c, i) => { if (pruefe(`${k}#${i}`, c, false)) gefunden = true; });
    if (!gefunden) pruefe(k, liste, true);
  }
  return ergebnis.sort((a, b) => a.betrag - b.betrag);
}

/* ── Vorschau ───────────────────────────────────────────── */

export type Art = 'muster' | 'posten' | 'rechnung' | 'rest' | 'wartung' | 'steuer' | 'ust' | 'variabel';
export interface Ereignis {
  datum: string;
  betrag: number;
  bezeichnung: string;
  gruppe: string;           // fix | finanzamt | steuerberater | einnahme | variabel
  art: Art;
  geschaetzt?: boolean;
  ueberfaellig?: boolean;
  privat?: boolean;
  key?: string;             // Muster-Schlüssel (für den Abgleich mit neuen Umsätzen)
}

export interface UstMonat { monat: string; ust: number; zahllast: number | null; vorsteuer: number | null; geschaetzt: boolean; faellig: string }

export interface Vorschau {
  start: { saldo: number; datum: string; auszug: string; nachAuszug: number };
  ereignisse: Ereignis[];
  privat: Ereignis[];
  monate: { monat: string; ein: number; aus: number; finanzamt: number; ende: number }[];
  tiefster: { saldo: number; datum: string };
  muster: Muster[];
  ust: UstMonat[];
  vorsteuerSchnitt: number;
  ustSchnitt: number;
  variabelSchnitt: number;
  ohneTermin: { bezeichnung: string; betrag: number }[];
}

const RECHNUNGSARTEN = ['invoice', 'partial_invoice', 'final_invoice', 'credit_note'];
const name = (d: RechnungLite) => d.recipient_company || d.recipient_name || 'Kunde';

/** USt laut eigenen Rechnungen je Monat (Sollbesteuerung: Rechnungsdatum). */
export function ustJeMonat(docs: RechnungLite[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of docs) {
    // „draft“ heißt hier nur „nicht als versendet markiert“ – mit Nummer ist die Rechnung ausgestellt (wie im Export)
    if (!RECHNUNGSARTEN.includes(d.kind) || d.status === 'cancelled' || !d.doc_date) continue;
    const k = monat(d.doc_date);
    m.set(k, r2((m.get(k) || 0) + (d.kind === 'credit_note' ? -1 : 1) * Number(d.vat || 0)));
  }
  return m;
}

export function berechneVorschau(o: {
  buchungen: LiqBuchung[];
  auszuege: LiqAuszug[];
  posten: LiqPosten[];
  steuer: LiqSteuer[];
  docs: RechnungLite[];
  heute: string;
  monateVoraus?: number;
  angebote?: AngebotLite[];
  wartung?: WartungLite[];
  vertraege?: VertragLite[];
}): Vorschau | null {
  const giroAuszuege = o.auszuege.filter((a) => a.konto === 'giro').sort((a, b) => a.stand_am.localeCompare(b.stand_am));
  const anker = giroAuszuege[giroAuszuege.length - 1];
  if (!anker) return null;
  const S = anker.stand_am;
  const ende = monatDazu(o.heute.slice(0, 7) + '-01', (o.monateVoraus ?? 12) + 1);
  const giro = o.buchungen.filter((b) => b.konto === 'giro');
  const nach = giro.filter((b) => b.datum > S);
  const A = nach.reduce((m, b) => (b.datum > m ? b.datum : m), S);   // letzter bekannter Tag
  const startSaldo = r2(Number(anker.saldo) + nach.reduce((s, b) => s + b.betrag, 0));
  const ev: Ereignis[] = [];
  const privat: Ereignis[] = [];

  // 1) Geplante Posten
  const aktivePosten = o.posten.filter((p) => p.aktiv);
  for (const p of aktivePosten) {
    const schritte = Math.max(0, p.intervall_monate);
    for (let i = 0, d = p.naechste_am; d < ende && i < 400; i++, d = monatDazu(p.naechste_am, schritte * i)) {
      if (p.bis_am && d > p.bis_am) break;
      if (d > S || p.privat) {
        // KöSt-Quartal schon in einer Steuerberater-Mail enthalten → nicht doppelt
        const inMail = p.gruppe === 'finanzamt' && o.steuer.some((s) => s.steuernummer === 'firma' && s.faellig_am === d && s.k_betrag);
        if (!inMail) (p.privat ? privat : ev).push({ datum: d, betrag: Number(p.betrag), bezeichnung: p.bezeichnung, gruppe: p.gruppe, art: 'posten', privat: p.privat });
      }
      if (!schritte) break;
    }
  }

  // 2) Erkannte Muster (ohne die, die ein Posten schon abdeckt oder ausblendet)
  const muster = erkenneMuster(o.buchungen, A).filter((m) => !o.posten.some((p) => passtMuster(p.muster, m.beispiel)));
  // Eingänge von Kunden nur als Muster, wenn der Betrag stabil ist (Dauerauftrag wie ET König) –
  // schwankende Beträge sind Zahlungen einzelner Rechnungen, die stehen schon als Rechnung/Restzahlung drin.
  for (const m of muster.filter((x) => x.betrag < 0 || !x.schwankend)) {
    for (let i = 1; i < 30; i++) {
      const d = monatDazu(m.letzte_am, i);
      if (d >= ende) break;
      if (d <= A) continue;
      ev.push({ datum: d, betrag: m.betrag, bezeichnung: m.bezeichnung, gruppe: m.betrag > 0 ? 'einnahme' : 'fix', art: 'muster', geschaetzt: m.schwankend, key: m.key.split('#')[0] });
    }
  }

  // 3) Kleinkram: alles Übrige der letzten 3 vollen Monate im Schnitt
  const bis3 = A.slice(0, 7) + '-01';
  const von3 = monatDazu(bis3, -3);
  const istMuster = (b: LiqBuchung) => {
    const k = `${b.betrag < 0 ? '-' : '+'}${schlagwort(b)}`;
    return muster.some((m) => m.key === k || m.key.startsWith(k + '#'));
  };
  const rest = giro.filter((b) => b.datum >= von3 && b.datum < bis3 && b.betrag < 0 && b.betrag > -1500
    && !FINANZAMT.test(`${b.partner} ${b.text}`) && !istMuster(b)
    && !o.posten.some((p) => passtMuster(p.muster, `${b.partner || ''} ${b.text || ''}`)));
  const variabelSchnitt = r2(rest.reduce((s, b) => s + b.betrag, 0) / 3);
  if (variabelSchnitt < 0) {
    for (let d = monatDazu(A.slice(0, 7) + '-20', A.slice(8) >= '20' ? 1 : 0); d < ende; d = monatDazu(d, 1)) {
      ev.push({ datum: d, betrag: variabelSchnitt, bezeichnung: 'Sonstige laufende Ausgaben (Durchschnitt)', gruppe: 'variabel', art: 'variabel', geschaetzt: true });
    }
  }

  // 4) Rechnungen: offen, Restzahlungen, Entwürfe
  const ohneTermin: { bezeichnung: string; betrag: number }[] = [];
  const spaetere = (d: RechnungLite) => !!d.projekt_id && o.docs.some((x) => x.id !== d.id && x.projekt_id === d.projekt_id
    && x.status !== 'cancelled' && x.created_at > d.created_at);
  for (const d of o.docs) {
    if (!RECHNUNGSARTEN.includes(d.kind) || d.kind === 'credit_note' || d.status === 'cancelled') continue;
    // Offene Rechnungen (auch „draft“: im Cockpit bleibt eine ausgestellte Rechnung bis zur Zahlung auf draft)
    if (!['paid', 'rejected'].includes(d.status) && d.number) {
      const offen = r2(Number(d.gross) - Number(d.paid_amount || 0));
      if (offen > 0.01) {
        const f = d.due_date || tagDazu(d.doc_date || o.heute, 14);
        ev.push({ datum: f < o.heute ? tagDazu(o.heute, 1) : f, betrag: offen, bezeichnung: `Rechnung ${d.number} ${name(d)}${f < o.heute ? ` (fällig seit ${f.slice(8)}.${f.slice(5, 7)}.)` : ''}`, gruppe: 'einnahme', art: 'rechnung' });
      }
    }
    if (Number(d.rest_offen) > 0 && !spaetere(d)) {
      const brutto = r2(Number(d.rest_offen) * 1.2);
      if (d.rest_faellig_am) {
        const f = tagDazu(d.rest_faellig_am, 14);
        ev.push({ datum: f < o.heute ? tagDazu(o.heute, 7) : f, betrag: brutto, bezeichnung: `Restzahlung ${name(d)}`, gruppe: 'einnahme', art: 'rest', geschaetzt: true });
      } else ohneTermin.push({ bezeichnung: `Restzahlung ${name(d)}`, betrag: brutto });
    }
  }

  // 4b) Gesicherte Aufträge: angenommene Angebote, zu denen es noch gar keine Rechnung gibt
  for (const a of o.angebote || []) {
    if (a.status !== 'accepted' || o.docs.some((d) => d.source_document === a.id && d.status !== 'cancelled')) continue;
    ohneTermin.push({ bezeichnung: `Auftrag ${a.number || ''} ${a.recipient_company || a.recipient_name || ''} (angenommen, noch keine Rechnung)`, betrag: Number(a.gross) });
  }

  // 4c) Wartung: Jahresrechnung im Voraus (12 × monatlich + USt), bezahlt ~14 Tage danach, jedes Jahr wieder
  const wartungsKunden: string[] = [];
  const jahresWartung = (kunde: string, ab: string, monatlich: number, herkunft: string) => {
    for (let d = ab, i = 0; i < 5; i++, d = monatDazu(ab, 12 * i)) {
      const f = tagDazu(d, 14);
      if (f >= ende) break;
      if (f > o.heute) ev.push({ datum: f, betrag: r2(monatlich * 12 * 1.2), bezeichnung: `Wartung ${kunde} (Jahresrechnung${herkunft})`, gruppe: 'einnahme', art: 'wartung', geschaetzt: true });
    }
  };
  for (const w of o.wartung || []) {
    wartungsKunden.push(w.kunde.toLowerCase());
    if (w.status === 'kein' || !(Number(w.monatlich_netto) > 0) || !w.start_am) continue;
    jahresWartung(w.kunde, w.abgerechnet_bis ? tagDazu(w.abgerechnet_bis, 1) : w.start_am, Number(w.monatlich_netto), '');
  }
  const schonVertrag = new Set<string>();
  for (const v of o.vertraege || []) {
    if (v.status !== 'signed' || !(Number(v.maintenance_monthly) > 0) || !v.customer_signed_at || !v.party_company) continue;
    const k = v.document_id || v.party_company;
    if (schonVertrag.has(k)) continue;
    schonVertrag.add(k);
    const erstes = v.party_company.toLowerCase().split(/[\s,-]+/).find((w) => w.length > 4 && !['holzbau', 'zimmerei', 'metallbau', 'elektro', 'tischlerei'].includes(w)) || v.party_company.toLowerCase();
    if (wartungsKunden.some((w) => w.includes(erstes))) continue;   // steht schon bei den Wartungsverträgen
    jahresWartung(v.party_company, monatDazu(v.customer_signed_at.slice(0, 10), Number(v.support_months) || 12), Number(v.maintenance_monthly), ', laut Vertrag');
  }

  // 5) Finanzamt: Zahlungsaufforderungen aus den Steuerberater-Mails …
  for (const s of o.steuer) {
    if (s.faellig_am <= S || s.faellig_am >= ende) continue;
    const teile = [s.u_monat ? `USt ${s.u_monat.slice(5, 7)}/${s.u_monat.slice(2, 4)}` : '', s.k_betrag ? 'KöSt' : '', s.e_betrag ? 'ESt' : ''].filter(Boolean).join(' + ');
    const e: Ereignis = { datum: s.faellig_am, betrag: -Number(s.gesamt), bezeichnung: `Finanzamt ${teile || 'Zahlung'}`, gruppe: 'finanzamt', art: 'steuer', privat: s.steuernummer === 'privat' };
    (s.steuernummer === 'privat' ? privat : ev).push(e);
  }
  // … und für die Monate danach geschätzte Umsatzsteuer
  const ustM = ustJeMonat(o.docs);
  const firmaU = o.steuer.filter((s) => s.steuernummer === 'firma' && s.u_monat && s.u_betrag != null)
    .sort((a, b) => a.u_monat!.localeCompare(b.u_monat!));
  const bekannt = firmaU.slice(-6).map((s) => ({ m: monat(s.u_monat!), zl: Number(s.u_betrag) }));
  const vst = bekannt.map((b) => (ustM.get(b.m) || 0) - b.zl);
  const vorsteuerSchnitt = r2(Math.max(0, vst.length ? vst.reduce((a, b) => a + b, 0) / vst.length : 0));
  const heuteM = monat(o.heute);
  const letzte6 = Array.from({ length: 6 }, (_, i) => monat(monatDazu(heuteM + '-01', -i - 1)));
  const ustSchnitt = r2(letzte6.reduce((s, m) => s + (ustM.get(m) || 0), 0) / 6);
  const ust: UstMonat[] = bekannt.map((b, i) => ({ monat: b.m, ust: ustM.get(b.m) || 0, zahllast: b.zl, vorsteuer: r2(vst[i]), geschaetzt: false, faellig: monatDazu(b.m + '-15', 2) }));
  const ustGeplant = new Map<string, number>();
  for (const e of ev) {
    if (e.betrag <= 0 || !['rest', 'wartung', 'muster'].includes(e.art)) continue;
    const k = monat(e.art === 'muster' ? e.datum : tagDazu(e.datum, -14));
    ustGeplant.set(k, r2((ustGeplant.get(k) || 0) + e.betrag / 6));   // 20 % USt im Brutto = 1/6
  }
  const abM = firmaU.length ? monat(monatDazu(firmaU[firmaU.length - 1].u_monat!, 1)) : monat(monatDazu(S, -1));
  for (let m = abM; ; m = monat(monatDazu(m + '-01', 1))) {
    const faellig = monatDazu(m + '-15', 2);
    if (faellig >= ende) break;
    const eigen = ustM.get(m) || 0;
    // Nur Umsätze, die auch in der Vorschau als Einnahme stehen: schon geschriebene Rechnungen + die geplanten
    // (Restrechnung/Wartung am Rechnungstag = Eingang − 14 Tage, Dauerauftrag im Monat des Eingangs). Sonst würde
    // für Umsatz Steuer gerechnet, der als Geld gar nicht eingeplant ist.
    const geplant = m < heuteM ? 0 : ustGeplant.get(m) || 0;
    const u = r2(eigen + geplant);
    const zl = r2(u - vorsteuerSchnitt);
    ust.push({ monat: m, ust: r2(u), zahllast: zl, vorsteuer: vorsteuerSchnitt, geschaetzt: true, faellig });
    if (faellig > S && zl > 0) ev.push({ datum: faellig, betrag: -zl, bezeichnung: `Umsatzsteuer ${m.slice(5)}/${m.slice(2, 4)} (geschätzt)`, gruppe: 'finanzamt', art: 'ust', geschaetzt: true });
  }

  // Schon im Konto sichtbar? Erwartete Zahlung, die ein Umsatz nach dem Auszug abdeckt:
  // Finanzamt: irgendeine Finanzamt-Abbuchung ±20 Tage (Gutschriften werden gegengerechnet, Betrag weicht ab);
  // Muster: gleiche Gegenseite ±10 Tage; Kundengeld: gleicher Betrag + Name passt, egal wann;
  // sonst: gleicher Betrag (±5 %) ±10 Tage.
  const passt = (e: Ereignis, b: LiqBuchung) => {
    if (Math.sign(b.betrag) !== Math.sign(e.betrag)) return false;
    // Restzahlung erst nach dem Schreiben der Restrechnung – Geld davor gehört zur Anzahlung
    if (e.art === 'rest' && b.datum < tagDazu(e.datum, -14)) return false;
    const bText = `${b.partner || ''} ${b.text || ''}`;
    if (e.art === 'steuer' || e.art === 'ust') return FINANZAMT.test(bText) && tage(b.datum, e.datum) <= 20;
    if (e.key) return `${b.betrag < 0 ? '-' : '+'}${schlagwort(b)}` === e.key && tage(b.datum, e.datum) <= 12;
    const gleich = Math.abs(b.betrag - e.betrag) <= Math.max(1, Math.abs(e.betrag) * 0.05);
    if (e.betrag > 0 && gleich) {
      const w = nameWort(b.partner || '');
      if (w.some((x) => e.bezeichnung.toLowerCase().includes(x)) && tage(b.datum, e.datum) <= 60) return true;
    }
    return gleich && tage(b.datum, e.datum) <= 10;
  };
  const verbraucht = new Set<LiqBuchung>();
  const tage = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 864e5;
  // Nur unterscheidende Namensteile – „GmbH“ oder „Holzbau“ allein darf zwei Firmen nicht gleichsetzen
  const ALLGEMEIN = new Set(['gmbh', 'gesmbh', 'gesellschaft', 'holzbau', 'zimmerei', 'metallbau', 'elektro', 'austria', 'österreich', 'firma']);
  const nameWort = (t: string) => t.toLowerCase().replace(/[^a-zäöüß ]+/g, ' ').split(' ').filter((w) => w.length > 3 && !ALLGEMEIN.has(w));
  ev.sort((a, b) => a.datum.localeCompare(b.datum));
  // Dauerauftrag und offene Rechnung desselben Kunden im selben Zeitraum = dieselbe Zahlung → Rechnung zählt
  const rechnungen = ev.filter((e) => e.art === 'rechnung');
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i];
    if (e.art !== 'muster' || e.betrag <= 0) continue;
    const kunde = nameWort(e.bezeichnung);
    if (rechnungen.some((r) => tage(r.datum, e.datum) <= 25 && kunde.some((w) => r.bezeichnung.toLowerCase().includes(w)))) ev.splice(i, 1);
  }
  const offen = ev.filter((e) => {
    if (e.datum > tagDazu(A, 60) || e.art === 'variabel') return true;
    const treffer = nach.find((b) => !verbraucht.has(b) && passt(e, b));
    if (treffer) { verbraucht.add(treffer); return false; }
    return true;
  }).map((e) => (e.datum <= A ? { ...e, datum: tagDazu(A, 1), ueberfaellig: true } : e))
    .sort((a, b) => a.datum.localeCompare(b.datum) || b.betrag - a.betrag);

  // Monatsübersicht + tiefster Stand
  let saldo = startSaldo;
  let tiefster = { saldo: startSaldo, datum: A };
  const monate: Vorschau['monate'] = [];
  for (const e of offen) {
    saldo = r2(saldo + e.betrag);
    if (saldo < tiefster.saldo) tiefster = { saldo, datum: e.datum };
    const k = monat(e.datum);
    let z = monate.find((x) => x.monat === k);
    if (!z) { z = { monat: k, ein: 0, aus: 0, finanzamt: 0, ende: 0 }; monate.push(z); }
    if (e.gruppe === 'finanzamt') z.finanzamt = r2(z.finanzamt + e.betrag);
    else if (e.betrag > 0) z.ein = r2(z.ein + e.betrag);
    else z.aus = r2(z.aus + e.betrag);
    z.ende = saldo;
  }

  return {
    start: { saldo: startSaldo, datum: A, auszug: S, nachAuszug: nach.length },
    ereignisse: offen, privat: privat.filter((e) => e.datum >= o.heute.slice(0, 7) + '-01' && e.datum < ende).sort((a, b) => a.datum.localeCompare(b.datum)),
    monate, tiefster, muster, ust, vorsteuerSchnitt, ustSchnitt, variabelSchnitt, ohneTermin,
  };
}

/** Kreditkarte: wofür das Geld im Schnitt der letzten 3 Monate pro Monat draufgeht. */
export function kreditkarteNachHaendler(buchungen: LiqBuchung[], stichtag: string) {
  const von = monatDazu(stichtag, -3);
  const m = new Map<string, number>();
  for (const b of buchungen) {
    if (b.konto !== 'kreditkarte' || b.datum <= von || b.datum > stichtag || b.betrag >= 0) continue;
    const roh = (b.text || b.partner || '?').replace(/inkl\..*$/i, '').replace(/[*].*$/, '').trim();
    const k = roh.split(/\s+/)[0].replace(/[^A-Za-zÄÖÜäöü0-9.-]/g, '').toUpperCase() || '?';
    m.set(k, (m.get(k) || 0) + b.betrag);
  }
  return [...m.entries()].map(([haendler, s]) => ({ haendler, proMonat: r2(s / 3) })).sort((a, b) => a.proMonat - b.proMonat);
}
