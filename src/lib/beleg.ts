/**
 * Beleg-Erfassung – gemeinsam für E-Mail (Anhang/Stripe-Link) und Portal (browser-use).
 *
 * Kern-Einsicht (echtes Postfach geprüft): fast alle Rechnungen liegen schon als PDF-Anhang
 * in der Mail (Stripe-Absender "invoice+statements@…", A1, Google Cloud, Paddle …). Wir holen
 * die Bytes, hashen sie (sha256 = harter Dedup), legen sie in Supabase Storage und erzeugen
 * einen Beleg(status="collected"). browser-use brauchen wir nur für OpenAI + den BMD-Upload.
 */
import crypto from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import { prisma } from "./db";
import { fetchAttachment, type RawMail } from "./gmail";
import { uploadBeleg } from "./supabase/server";
import type { Beleg } from "@prisma/client";

// ── Erkennung: ist das eine Rechnung/ein Beleg? ──────────────
const STRIPE_SENDER = /(^|[<\s])invoice\+statements@|@stripe\.com/i;
const INVOICE_WORDS = /(rechnung|receipt|invoice|beleg|faktura|zahlungsbestätigung|payment receipt|quittung)/i;

/** Heuristik: lohnt es sich, aus dieser Mail einen Beleg zu erfassen? */
export function looksLikeInvoice(raw: RawMail, labels: string[]): boolean {
  if (raw.outgoing) return false;
  const hasPdf = raw.attachments.some((a) => isPdf(a.mimeType, a.filename));
  const stripe = STRIPE_SENDER.test(raw.fromAddr);
  const wordy = INVOICE_WORDS.test(raw.subject) || INVOICE_WORDS.test(raw.fromAddr);
  const buchhaltung = labels.includes("buchhaltung");
  // Stripe-Absender ODER (PDF-Anhang UND (Buchhaltungs-Label ODER Rechnungs-Wort)).
  if (stripe) return true;
  if (hasPdf && (buchhaltung || wordy)) return true;
  if (buchhaltung && extractStripePdfLink(raw.body)) return true;
  return false;
}

function isPdf(mime: string, filename: string): boolean {
  return /pdf/i.test(mime) || /\.pdf$/i.test(filename);
}

/** Findet einen direkten Stripe-Rechnungs-PDF-Link (…/pdf) im Mailtext. */
export function extractStripePdfLink(body: string): string | null {
  const m = body.match(/https:\/\/[^\s"'<>()]*(?:pay\.stripe\.com\/invoice|stripe\.com\/[^\s"'<>()]*receipts)[^\s"'<>()]*\/pdf[^\s"'<>()]*/i);
  return m ? m[0] : null;
}

// ── Vendor-Auflösung aus dem Absender ────────────────────────
const VENDOR_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  vercel: "Vercel",
  supabase: "Supabase",
  elevenlabs: "ElevenLabs",
  bitwarden: "Bitwarden",
  lovable: "Lovable",
  wispr: "Wispr Flow",
  a1: "A1 Telekom",
  paddle: "Paddle",
  stripe: "Stripe",
};

// Zahlungsabwickler: hier steht der echte Händler im Betreff, nicht in der Absender-Domain.
const PROCESSORS = new Set(["stripe", "paddle", "lemonsqueezy", "paypal"]);

export function vendorFromSender(fromAddr: string, fromName: string): { vendor: string; vendorKey: string } {
  const domain = (fromAddr.split("@")[1] || "").toLowerCase();
  // host ohne TLD/Subdomains: "mail.anthropic.com" -> "anthropic"
  const parts = domain.split(".").filter(Boolean);
  const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "";
  const key = core.replace(/[^a-z0-9]/g, "") || "vendor";
  const vendor = VENDOR_NAMES[key] || titleCase(fromName.trim() || core);
  return { vendor, vendorKey: key };
}

/** Holt den echten Händler aus dem Betreff (für Stripe/Paddle-Belege). */
export function vendorFromSubject(subject: string): string | null {
  const m = subject.match(
    /(?:receipt from|payment received for|Zahlungsbeleg(?:\s+Nr\.?\s*[\w-]+)?\s+von|Rechnung von|invoice from)\s+(.+?)\s*(?:#|\binvoice\b|\(|$)/i
  );
  if (!m) return null;
  const name = m[1].trim().replace(/[.,#]+$/, "").trim();
  return name.length >= 2 ? name : null;
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 40) || "vendor";
}

/** Vendor auflösen: bei Zahlungsabwicklern den Händler aus dem Betreff bevorzugen. */
export function resolveVendor(fromAddr: string, fromName: string, subject: string): { vendor: string; vendorKey: string } {
  const base = vendorFromSender(fromAddr, fromName);
  if (PROCESSORS.has(base.vendorKey)) {
    const merchant = vendorFromSubject(subject);
    if (merchant) return { vendor: merchant, vendorKey: slug(merchant) };
  }
  return base;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Betrag / Metadaten aus Betreff+Body (Regex, kein API-Call) ─
export interface BelegMeta {
  amount: number | null;
  currency: string;
  invoiceNumber: string | null;
}

const CUR = (sym: string): string => (/€|eur/i.test(sym) ? "EUR" : /\$|usd/i.test(sym) ? "USD" : sym.toUpperCase());

/** "1.234,56" oder "1,234.56" -> 1234.56 */
function parseMoney(raw: string): number | null {
  const s0 = raw.replace(/[^\d.,]/g, "");
  if (!s0) return null;
  const lastComma = s0.lastIndexOf(",");
  const lastDot = s0.lastIndexOf(".");
  let s = s0;
  if (lastComma > lastDot) s = s0.replace(/\./g, "").replace(",", "."); // Komma = Dezimal
  else s = s0.replace(/,/g, ""); // Punkt = Dezimal (oder nur Tausender-Kommas)
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

/** Extrahiert Betrag/Währung/Rechnungsnummer best effort aus Betreff + Body. */
export function extractBelegMeta(subject: string, body: string): BelegMeta {
  const text = `${subject}\n${body}`;
  const re = /(?:(€|EUR|\$|USD)\s?([\d.,]+))|(?:([\d.,]+)\s?(€|EUR|USD))/gi;
  const cands: { amount: number; currency: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const sym = m[1] || m[4] || "EUR";
    const num = m[2] || m[3] || "";
    const amount = parseMoney(num);
    if (amount != null && amount > 0) cands.push({ amount, currency: CUR(sym), idx: m.index });
  }
  let amount: number | null = null;
  let currency = "EUR";
  if (cands.length) {
    // Bevorzuge Beträge nahe einem Schlüsselwort (paid/total/betrag/summe), sonst den größten.
    const KW = /(amount paid|total|betrag|rechnungsbetrag|summe|gesamt|paid)/gi;
    let best = cands[0];
    let bestScore = -1;
    for (const c of cands) {
      const around = text.slice(Math.max(0, c.idx - 40), c.idx + 10).toLowerCase();
      const score = (KW.test(around) ? 1000 : 0) + c.amount;
      KW.lastIndex = 0;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    amount = best.amount;
    currency = best.currency;
  }
  const inv = text.match(/(?:rechnung|invoice|receipt|beleg|nr|no|#)[\s.:#-]*([A-Z0-9][A-Z0-9\-]{3,})/i);
  return { amount, currency, invoiceNumber: inv ? inv[1] : null };
}

export function periodMonthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Metadaten aus dem PDF-Text (bevorzugt vor Mail-Body) ─────
export interface PdfMeta {
  invoiceDate: Date | null; // aus "Rechnungsdatum" – maßgeblich für Monat/Periode
  amount: number | null;
  currency: string | null;
  invoiceNumber: string | null;
}

/** Liest Rechnungsdatum, Betrag & Nummer aus den PDF-Bytes. Fehler → alles null (Fallback greift). */
export async function extractPdfMeta(bytes: Uint8Array): Promise<PdfMeta> {
  const empty: PdfMeta = { invoiceDate: null, amount: null, currency: null, invoiceNumber: null };
  try {
    const pdf = await getDocumentProxy(bytes);
    const res = await extractText(pdf, { mergePages: true });
    const text = Array.isArray(res.text) ? res.text.join("\n") : res.text || "";
    return text ? parseInvoicePdf(text) : empty;
  } catch {
    return empty;
  }
}

function parseInvoicePdf(text: string): PdfMeta {
  // Rechnungsdatum (DD.MM.YYYY) – die Regel: der Monat kommt aus DIESEM Datum, nicht vom Mail-Eingang.
  let invoiceDate: Date | null = null;
  const dm =
    text.match(/Rechnungs?datum\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i) ||
    text.match(/(?:Belegdatum|Invoice date|Date of issue)\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (dm) invoiceDate = new Date(Date.UTC(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1])));

  // Rechnungsnummer
  const nm =
    text.match(/Rechnungs?nummer\s*:?\s*([A-Za-z0-9][A-Za-z0-9/\-]{2,})/i) ||
    text.match(/(?:Invoice (?:no\.?|number)|Rechnung\s*Nr\.?)\s*:?\s*([A-Za-z0-9][A-Za-z0-9/\-]{2,})/i);
  const invoiceNumber = nm ? nm[1] : null;

  // Betrag: nach dem aussagekräftigsten Label (Rechnungsbetrag > Gesamt > …)
  const LABELS = [
    "Rechnungsbetrag", "Gesamtbetrag", "Zahlbetrag", "Bruttobetrag", "Gesamtbruttobetrag",
    "Zu zahlen", "Amount paid", "Amount due", "Total amount", "Gesamt", "Total",
  ];
  let amount: number | null = null;
  let currency: string | null = null;
  for (const label of LABELS) {
    const re = new RegExp(label + "\\s*:?\\s*(€|EUR|\\$|USD)?\\s*([\\d.,]+)\\s*(€|EUR|\\$|USD)?", "i");
    const m = text.match(re);
    const val = m ? parseMoney(m[2]) : null;
    if (val != null && val > 0) {
      amount = val;
      const sym = m![1] || m![3];
      currency = sym ? CUR(sym) : null;
      break;
    }
  }
  if (amount != null && !currency) currency = /€|EUR/.test(text) ? "EUR" : /\$|USD/.test(text) ? "USD" : "EUR";
  return { invoiceDate, amount, currency, invoiceNumber };
}

// ── Erfassen: Bytes -> Storage -> Beleg ──────────────────────
export interface CaptureInput {
  kind?: string; // default "rechnung"
  source: string; // "email" | "portal" | "upload"
  sourceEmailId?: string | null;
  vendor: string;
  vendorKey?: string | null;
  bytes: Buffer | Uint8Array;
  fileName: string;
  fileMime?: string;
  invoiceNumber?: string | null;
  invoiceDate?: Date | null;
  periodMonth?: string | null;
  amount?: number | null;
  currency?: string;
  sourceUrl?: string | null;
}

/**
 * Speichert die Bytes (Dedup via sha256) und legt einen Beleg an.
 * Gibt den Beleg zurück oder null, wenn er (per fileSha) schon existiert.
 */
export async function captureBeleg(input: CaptureInput): Promise<Beleg | null> {
  const bytes = input.bytes instanceof Buffer ? new Uint8Array(input.bytes) : input.bytes;
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");

  // Schicht 1: harter Dedup über fileSha (vorab geprüft, plus Unique-Constraint als Sicherung).
  const existing = await prisma.beleg.findUnique({ where: { fileSha: sha } });
  if (existing) return null;

  const kind = input.kind || "rechnung";
  const period = input.periodMonth || periodMonthOf(input.invoiceDate || new Date());
  const safeName = input.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "beleg.pdf";
  const storagePath = `${kind}/${period}/${sha.slice(0, 16)}-${safeName}`;

  await uploadBeleg(storagePath, bytes, input.fileMime || "application/pdf");

  try {
    return await prisma.beleg.create({
      data: {
        kind,
        source: input.source,
        sourceEmailId: input.sourceEmailId ?? null,
        vendor: input.vendor,
        vendorKey: input.vendorKey ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        invoiceDate: input.invoiceDate ?? null,
        periodMonth: period,
        amount: input.amount ?? null,
        currency: input.currency || "EUR",
        fileName: input.fileName,
        fileMime: input.fileMime || "application/pdf",
        fileSize: bytes.byteLength,
        storagePath,
        fileSha: sha,
        status: "collected",
      },
    });
  } catch (e) {
    // Race: zweiter Insert mit gleicher fileSha -> Unique-Constraint schlucken (wie gmailSync).
    if (String((e as Error).message).includes("Unique constraint")) return null;
    throw e;
  }
}

/** Wählt den besten PDF-Anhang: bevorzugt "Invoice…" vor "Receipt…". */
function pickInvoiceAttachment(raw: RawMail) {
  const pdfs = raw.attachments.filter((a) => isPdf(a.mimeType, a.filename));
  if (!pdfs.length) return null;
  const invoice = pdfs.find((a) => /invoice|rechnung|faktura/i.test(a.filename));
  return invoice || pdfs[0];
}

/**
 * Erfasst aus einer eingehenden Mail einen Beleg (PDF-Anhang bevorzugt, sonst Stripe-Link).
 * Idempotent über fileSha. Gibt den Beleg zurück oder null.
 */
export async function captureBelegeFromEmail(emailId: string | null, raw: RawMail): Promise<Beleg | null> {
  const { vendor, vendorKey } = resolveVendor(raw.fromAddr, raw.fromName, raw.subject);

  // 1) PDF-Bytes besorgen (Anhang bevorzugt, sonst Stripe-Link)
  let bytes: Buffer | null = null;
  let fileName = "";
  let fileMime = "application/pdf";
  let sourceUrl: string | null = null;
  const att = pickInvoiceAttachment(raw);
  if (att) {
    bytes = await fetchAttachment(raw.account, raw.gmailId, att.attachmentId);
    fileName = att.filename;
    fileMime = att.mimeType;
  } else {
    const link = extractStripePdfLink(raw.body);
    if (link) {
      const res = await fetch(link);
      if (res.ok) {
        bytes = Buffer.from(await res.arrayBuffer());
        fileName = `${vendorKey}-${raw.receivedAt.toISOString().slice(0, 10)}.pdf`;
        sourceUrl = link;
      }
    }
  }
  if (!bytes) return null;

  // 2) Metadaten: PDF (Rechnungsdatum/Betrag) ist maßgeblich, Mail-Body nur Fallback.
  const body = extractBelegMeta(raw.subject, raw.body);
  const pdf = await extractPdfMeta(new Uint8Array(bytes));
  const invoiceDate = pdf.invoiceDate || raw.receivedAt; // Regel: Monat = Rechnungsdatum aus dem PDF
  const amount = pdf.amount ?? body.amount;
  const currency = pdf.currency || body.currency;
  const invoiceNumber = pdf.invoiceNumber || body.invoiceNumber;

  return captureBeleg({
    source: "email",
    sourceEmailId: emailId,
    vendor,
    vendorKey,
    bytes,
    fileName,
    fileMime,
    sourceUrl,
    invoiceNumber,
    invoiceDate,
    periodMonth: periodMonthOf(invoiceDate),
    amount,
    currency,
  });
}
