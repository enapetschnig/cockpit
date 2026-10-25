/**
 * Zentrale Konfiguration (Keys) – liest zuerst aus der DB-Tabelle `Setting`,
 * fällt auf die Env-Var gleichen Namens zurück. So braucht Vercel nur DATABASE_URL/DIRECT_URL,
 * der Rest (OpenAI, Google, Telegram) liegt in Supabase und ist ohne Redeploy änderbar.
 * Geheime Keys (GEHEIME_KEYS) liegen dort verschlüsselt ("enc1:…"); den Schlüssel dafür gibt es nur
 * als Env-Var COCKPIT_GEHEIMNIS_KEY (siehe geheimnis.ts) – nie in der DB.
 */
import { prisma } from "./db";
import { entschluesseln, verschluesseln } from "./geheimnis";

// Keys, die über die App/DB verwaltet werden
export const SETTING_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  // ── Buchhaltung / BMD ────────────────────────────────────
  "SUPABASE_URL", // Supabase-Projekt-URL (für Storage-Server-Client)
  "SUPABASE_SERVICE_ROLE_KEY", // schreibt in den privaten "belege"-Bucket
  "BROWSER_USE_API_KEY", // browser-use Cloud (BMD-Upload)
  "BMD_PORTAL_URL", // Login-URL des BMD-Com-Webportals
  "BMD_PORTAL_CUSTOMER", // Kundennummer/Mandant (falls ≠ Benutzer)
  "BMD_PORTAL_USER",
  "BMD_PORTAL_PASSWORD",
  // ── Werbeanzeigen (Meta Ads) ─────────────────────────────
  "ADS_TOKEN_KEY", // Schlüssel zum Ver-/Entschlüsseln der Meta-Access-Tokens
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

// Geheime Keys: in der DB nur verschlüsselt. Kein externes Werkzeug liest einen davon direkt per SQL
// (Roboter/Plaud/hw-Skripte gehen über /api/roboter/melden) – käme so ein Leser dazu, muss sein Key hier raus.
export const GEHEIME_KEYS = [
  "OPENAI_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET", // von /api/telegram/setup erzeugt, prüft den Header der Webhook-Aufrufe
  "SUPABASE_SERVICE_ROLE_KEY",
  "BROWSER_USE_API_KEY",
  "BMD_PORTAL_PASSWORD",
  "ADS_TOKEN_KEY", // verschlüsselt seinerseits die Meta-Tokens (adsCrypto.ts)
  "APP_PASSWORD", // Altlast vom früheren Passwort-Login (seit Supabase-Auth ungelesen), liegt noch in der DB
] as const;
const GEHEIM = new Set<string>(GEHEIME_KEYS);

const CACHE = new Map<string, { v: string | null; t: number }>();
const TTL_MS = 30_000;

/** Wert holen: DB-Setting > Env-Var. Leere Werte = null. Mit kurzem Cache. */
export async function getConfig(key: string): Promise<string | null> {
  const now = Date.now();
  const hit = CACHE.get(key);
  if (hit && now - hit.t < TTL_MS) return hit.v;

  let v: string | null = null;
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    v = row?.value?.trim() || null;
  } catch {
    // DB (noch) nicht erreichbar -> Env-Fallback
  }
  // "enc1:…" entschlüsseln (Klartext geht durch). Bewusst außerhalb des try: fehlender/falscher
  // COCKPIT_GEHEIMNIS_KEY soll laut auffallen statt still als "Key fehlt" durchzugehen.
  if (v) v = entschluesseln(v).trim() || null;
  if (!v) v = process.env[key]?.trim() || null;

  CACHE.set(key, { v, t: now });
  return v;
}

/** Mehrere Werte gleichzeitig (eine DB-Abfrage). */
export async function getConfigs<K extends string>(keys: K[]): Promise<Record<K, string | null>> {
  const out = {} as Record<K, string | null>;
  await Promise.all(keys.map(async (k) => (out[k] = await getConfig(k))));
  return out;
}

/** Werte speichern (leere überspringen, damit nichts versehentlich gelöscht wird). */
export async function setConfigs(entries: Record<string, string | undefined>): Promise<string[]> {
  const saved: string[] = [];
  for (const [key, raw] of Object.entries(entries)) {
    if (!SETTING_KEYS.includes(key as SettingKey)) continue;
    const value = (raw ?? "").trim();
    if (value === "") continue;
    await speichern(key, value);
    saved.push(key);
  }
  return saved;
}

/** Einzelnen Wert speichern – auch Keys außerhalb der UI-Liste (z. B. TELEGRAM_WEBHOOK_SECRET). Nur serverintern. */
export async function setConfig(key: string, raw: string): Promise<void> {
  const value = raw.trim();
  if (value) await speichern(key, value);
}

/** Geheime Keys verschlüsselt ablegen (ohne COCKPIT_GEHEIMNIS_KEY vorerst Klartext, siehe geheimnis.ts). */
async function speichern(key: string, value: string): Promise<void> {
  const stored = GEHEIM.has(key) ? verschluesseln(value) : value;
  await prisma.setting.upsert({ where: { key }, create: { key, value: stored }, update: { value: stored } });
  CACHE.delete(key);
}

export function clearConfigCache(): void {
  CACHE.clear();
}

/** Für die Settings-UI: welche Keys sind gesetzt (maskiert, nie der volle Wert). */
export async function configStatus(): Promise<Record<string, { set: boolean; source: "db" | "env" | null; hint: string }>> {
  const out: Record<string, { set: boolean; source: "db" | "env" | null; hint: string }> = {};
  for (const key of SETTING_KEYS) {
    let source: "db" | "env" | null = null;
    let value: string | null = null;
    try {
      const row = await prisma.setting.findUnique({ where: { key } });
      if (row?.value?.trim()) {
        value = row.value.trim();
        source = "db";
      }
    } catch {
      /* ignore */
    }
    if (!value && process.env[key]?.trim()) {
      value = process.env[key]!.trim();
      source = "env";
    }
    out[key] = { set: !!value, source, hint: value ? hintFor(value) : "" };
  }
  return out;
}

/** Maske des ENTSCHLÜSSELTEN Werts – ist er nicht lesbar, ein Hinweis statt Chiffrat-Schnipseln. */
function hintFor(v: string): string {
  try {
    return mask(entschluesseln(v).trim());
  } catch {
    return "nicht entschlüsselbar – COCKPIT_GEHEIMNIS_KEY prüfen";
  }
}

function mask(v: string): string {
  if (v.length <= 6) return "••••";
  return v.slice(0, 3) + "…" + v.slice(-3);
}
