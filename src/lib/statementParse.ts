/**
 * Kontoauszug-/Kreditkarten-Parser. MVP: George/Erste-CSV (Export "Umsätze").
 * George-Eigenheiten: Delimiter ";" (Fallback ","), Encoding UTF-16LE mit BOM,
 * deutsche Zahlen "-1.234,56", Datum "DD.MM.YYYY", Spalten frei wählbar/umsortierbar
 * → NIE per Index, immer per Header-Synonym mappen. Pro kaputter Zeile: skippen, nicht werfen.
 * PDF wird (MVP) nicht geparst – der Beleg wird trotzdem archiviert/ans BMD geladen.
 */

export interface NormalizedBooking {
  bookingDate: Date;
  amount: number; // signiert: Ausgabe negativ
  currency: string;
  counterparty: string | null;
  purpose: string | null;
  reference: string | null;
  raw: string; // Original-Zeile als JSON (Audit/Reparse)
}

// Header-Synonyme (lowercase). Reihenfolge egal – wir matchen per Name.
const COLS: Record<keyof Omit<NormalizedBooking, "raw" | "bookingDate" | "amount"> | "bookingDate" | "amount", string[]> = {
  bookingDate: ["buchungsdatum", "buchungstag", "booking", "datum", "buchung"],
  amount: ["betrag", "umsatz", "amount", "betrag in eur"],
  currency: ["währung", "waehrung", "currency"],
  counterparty: ["empfänger", "empfaenger", "auftraggeber/empfänger", "auftraggeber", "partnername", "begünstigter", "beguenstigter", "receiver", "name", "zahlungsempfänger"],
  purpose: ["verwendungszweck", "buchungstext", "zahlungsgrund", "verwendung", "text"],
  reference: ["buchungsreferenz", "zahlungsreferenz", "referencenumber", "referenz", "kundenreferenz"],
};

export function parseStatement(bytes: Buffer | Uint8Array, filename: string, mime?: string): NormalizedBooking[] {
  const isCsv = /\.csv$/i.test(filename) || /csv|text\/plain/i.test(mime || "");
  if (!isCsv) return []; // PDF/sonst: nicht parsen (nur archivieren)
  const text = decodeText(bytes);
  const delim = text.includes(";") ? ";" : ",";
  const rows = parseCsv(text, delim).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const idx = mapColumns(header);
  if (idx.bookingDate < 0 || idx.amount < 0) return []; // ohne Datum+Betrag nicht verwertbar

  const out: NormalizedBooking[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    try {
      const date = parseDate(cell(r, idx.bookingDate));
      const amount = parseSignedMoney(cell(r, idx.amount));
      if (!date || amount == null) continue;
      out.push({
        bookingDate: date,
        amount,
        currency: normCurrency(cell(r, idx.currency)),
        counterparty: clean(cell(r, idx.counterparty)) || null,
        purpose: clean(cell(r, idx.purpose)) || null,
        reference: clean(cell(r, idx.reference)) || null,
        raw: JSON.stringify(rowObject(header, r)),
      });
    } catch {
      // einzelne Zeile überspringen
    }
  }
  return out;
}

// ── Helfer ───────────────────────────────────────────────────
function decodeText(bytes: Buffer | Uint8Array): string {
  const u8 = bytes instanceof Buffer ? new Uint8Array(bytes) : bytes;
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder("utf-8").decode(u8.subarray(3));
  return new TextDecoder("utf-8").decode(u8);
}

function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQ = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      /* skip */
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function mapColumns(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  for (const key of Object.keys(COLS)) {
    const syns = COLS[key as keyof typeof COLS];
    idx[key] = header.findIndex((h) => syns.some((s) => h === s || h.includes(s)));
  }
  return idx;
}

function cell(r: string[], i: number): string {
  return i >= 0 && i < r.length ? r[i] : "";
}
function clean(s: string): string {
  return s.trim().replace(/^"|"$/g, "").replace(/\s+/g, " ");
}
function rowObject(header: string[], r: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  header.forEach((h, i) => (o[h || `col${i}`] = (r[i] ?? "").trim()));
  return o;
}

function normCurrency(s: string): string {
  const t = clean(s).toUpperCase();
  if (!t || t === "€") return "EUR";
  if (t === "$") return "USD";
  return t.slice(0, 3) || "EUR";
}

/** "-1.234,56" / "1,234.56" / "-12,90" → signierte Zahl. */
function parseSignedMoney(raw: string): number | null {
  const t = clean(raw);
  if (!t) return null;
  const neg = /^-|^\(|-\s*$/.test(t) || /^\(.*\)$/.test(t);
  const s0 = t.replace(/[^\d.,]/g, "");
  if (!s0) return null;
  const lastComma = s0.lastIndexOf(",");
  const lastDot = s0.lastIndexOf(".");
  let s = s0;
  if (lastComma > lastDot) s = s0.replace(/\./g, "").replace(",", ".");
  else s = s0.replace(/,/g, "");
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** "DD.MM.YYYY" (auch "D.M.YY") oder ISO → Date (UTC-Mitternacht). */
function parseDate(raw: string): Date | null {
  const t = clean(raw);
  if (!t) return null;
  let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}
