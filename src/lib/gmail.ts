/**
 * Gmail-Anbindung (Phase 1b) – echte Mails aus zwei Postfächern (Firma + privat).
 *
 * Ablauf:
 *  1) OAuth pro Konto: getAuthUrl() -> Google-Consent -> /api/gmail/callback -> handleCallback()
 *     speichert das Refresh-Token verschlüsselt-light in der DB (Model GmailAccount, Schema cockpit).
 *  2) Sync: fetchNewRawMails(account) holt neue Nachrichten via Gmail API (Dedupe über gmailId).
 *     Die Klassifizierung + DB-Ablage passiert in /api/gmail/sync.
 *
 * Setup-Anleitung: docs/09-gmail-anbindung.md
 */
import { google } from "googleapis";
import { prisma } from "./db";
import { getConfig } from "./config";

export type Account = "firma" | "privat";

export interface RawMail {
  account: Account;
  gmailId: string;
  threadId: string;
  fromAddr: string;
  fromName: string;
  subject: string;
  body: string;
  receivedAt: Date;
  outgoing: boolean; // true = selbst gesendet (Gmail-Label SENT)
}

// Lesen + Entwürfe erstellen (für die Telegram-Antwort-Funktion).
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

export async function isGmailConfigured(): Promise<boolean> {
  const [id, secret] = await Promise.all([getConfig("GOOGLE_CLIENT_ID"), getConfig("GOOGLE_CLIENT_SECRET")]);
  return Boolean(id && secret);
}

async function oauthClient(redirectUri?: string) {
  const [clientId, clientSecret] = await Promise.all([getConfig("GOOGLE_CLIENT_ID"), getConfig("GOOGLE_CLIENT_SECRET")]);
  if (!clientId || !clientSecret) {
    throw new Error("Gmail nicht konfiguriert: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen. Eintragen unter /connect → Einstellungen.");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri || "http://localhost:3000/api/gmail/callback");
}

/** Consent-URL für den OAuth-Flow. `state` trägt das Konto durch den Redirect. */
export async function getAuthUrl(account: Account, redirectUri: string): Promise<string> {
  const client = await oauthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline", // -> Refresh-Token
    prompt: "select_account consent", // Konto-Auswahl erzwingen + Refresh-Token sichern
    scope: SCOPES,
    state: account,
    include_granted_scopes: true,
  });
}

/** Tauscht den Auth-Code gegen Tokens, liest die Gmail-Adresse und speichert das Konto. */
export async function handleCallback(code: string, account: Account, redirectUri: string): Promise<{ account: Account; email: string | null }> {
  const client = await oauthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Verbundene Gmail-Adresse holen
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress ?? null;

  await prisma.gmailAccount.upsert({
    where: { account },
    create: { account, email, refreshToken: tokens.refresh_token ?? null },
    // Refresh-Token nur überschreiben, wenn Google ein neues geliefert hat
    update: { email, ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}) },
  });

  return { account, email };
}

export interface ConnectedAccount {
  account: Account;
  email: string | null;
  connected: boolean;
  lastSyncAt: Date | null;
}

/** Status beider Postfächer für die Verbinden-Seite. */
export async function listAccounts(): Promise<ConnectedAccount[]> {
  const rows = await prisma.gmailAccount.findMany();
  const byAcc = new Map(rows.map((r) => [r.account, r]));
  return (["firma", "privat"] as Account[]).map((account) => {
    const r = byAcc.get(account);
    return {
      account,
      email: r?.email ?? null,
      connected: Boolean(r?.refreshToken),
      lastSyncAt: r?.lastSyncAt ?? null,
    };
  });
}

/** Holt neue Nachrichten eines Kontos (nur solche, die noch nicht in der DB sind). */
export async function fetchNewRawMails(account: Account, opts?: { max?: number; query?: string }): Promise<RawMail[]> {
  const acc = await prisma.gmailAccount.findUnique({ where: { account } });
  if (!acc?.refreshToken) throw new Error(`Konto "${account}" ist nicht verbunden.`);

  const client = await oauthClient();
  client.setCredentials({ refresh_token: acc.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: client });

  const list = await gmail.users.messages.list({
    userId: "me",
    maxResults: opts?.max ?? 25,
    q: opts?.query ?? "newer_than:30d -category:promotions -category:social",
  });
  const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  if (ids.length === 0) return [];

  // Schon importierte Mails überspringen (Dedupe über gmailId)
  const known = await prisma.email.findMany({ where: { gmailId: { in: ids } }, select: { gmailId: true } });
  const knownSet = new Set(known.map((e) => e.gmailId));
  const fresh = ids.filter((id) => !knownSet.has(id));

  const out: RawMail[] = [];
  for (const id of fresh) {
    const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const payload = msg.data.payload;
    const headers = payload?.headers ?? [];
    const from = parseFrom(decodeMimeWords(header(headers, "From")));
    out.push({
      account,
      gmailId: id,
      threadId: msg.data.threadId ?? id,
      fromAddr: from.addr,
      fromName: from.name,
      subject: decodeMimeWords(header(headers, "Subject")) || "(kein Betreff)",
      body: extractBody(payload) || msg.data.snippet || "",
      receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date(),
      outgoing: (msg.data.labelIds ?? []).includes("SENT"),
    });
  }
  return out;
}

export async function markSynced(account: Account): Promise<void> {
  await prisma.gmailAccount.update({ where: { account }, data: { lastSyncAt: new Date() } });
}

// ── Helfer: Header / Absender / Body ─────────────────────────
type Header = { name?: string | null; value?: string | null };

function header(headers: Header[], name: string): string {
  return headers.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Dekodiert RFC-2047 "Encoded-Words" (=?UTF-8?B?…?= / =?…?Q?…?=) in Header wie Betreff/Absender. */
function decodeMimeWords(input: string): string {
  if (!input || !input.includes("=?")) return input;
  const joined = input.replace(/\?=\s+=\?/g, "?==?"); // Whitespace zwischen Encoded-Words entfernen
  return joined.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
    try {
      let bytes: Buffer;
      if (enc.toUpperCase() === "B") {
        bytes = Buffer.from(text, "base64");
      } else {
        const q = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
        bytes = Buffer.from(q, "binary");
      }
      return bytes.toString(nodeCharset(charset));
    } catch {
      return text;
    }
  });
}

function nodeCharset(charset: string): BufferEncoding {
  const c = charset.toLowerCase();
  if (c.includes("utf-8") || c.includes("utf8")) return "utf8";
  if (c.includes("8859-1") || c.includes("8859-15") || c.includes("1252") || c.includes("latin1")) return "latin1";
  if (c.includes("utf-16")) return "utf16le";
  return "utf8";
}

function parseFrom(raw: string): { name: string; addr: string } {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), addr: m[2].trim() };
  const addr = raw.trim();
  return { name: addr.split("@")[0] || addr, addr };
}

function decodeB64(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

interface MimePart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: MimePart[] | null;
}

function findPart(part: MimePart | null | undefined, mime: string): MimePart | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

function extractBody(payload: MimePart | null | undefined): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeB64(plain.body.data).trim();
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return stripHtml(decodeB64(html.body.data)).trim();
  if (payload.body?.data) return decodeB64(payload.body.data).trim();
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Erstellt einen Antwort-Entwurf im selben Thread (für die Telegram-Antwort-Funktion). */
export async function createReplyDraft(
  account: Account,
  gmailId: string,
  bodyText: string
): Promise<{ draftId: string; to: string; subject: string }> {
  const acc = await prisma.gmailAccount.findUnique({ where: { account } });
  if (!acc?.refreshToken) throw new Error(`Konto "${account}" ist nicht verbunden.`);
  const client = await oauthClient();
  client.setCredentials({ refresh_token: acc.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: client });

  const orig = await gmail.users.messages.get({
    userId: "me",
    id: gmailId,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Message-ID", "References"],
  });
  const h = (orig.data.payload?.headers ?? []) as Header[];
  const to = parseFrom(decodeMimeWords(header(h, "From"))).addr;
  const subjRaw = decodeMimeWords(header(h, "Subject")) || "(kein Betreff)";
  const subject = /^re:/i.test(subjRaw) ? subjRaw : `Re: ${subjRaw}`;
  const messageId = header(h, "Message-ID");
  const references = [header(h, "References"), messageId].filter(Boolean).join(" ");

  const raw = buildRawEmail({ from: acc.email || "me", to, subject, inReplyTo: messageId, references, body: bodyText });

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw, threadId: orig.data.threadId ?? undefined } },
  });
  return { draftId: draft.data.id ?? "", to, subject };
}

function buildRawEmail(o: { from: string; to: string; subject: string; inReplyTo?: string; references?: string; body: string }): string {
  const lines = [
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: ${encodeSubject(o.subject)}`,
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : "",
    o.references ? `References: ${o.references}` : "",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    o.body,
  ].filter((l) => l !== "");
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

function encodeSubject(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}
