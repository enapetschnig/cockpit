/**
 * Zentrale Konfiguration (Keys) – liest zuerst aus der DB-Tabelle `Setting`,
 * fällt auf die Env-Var gleichen Namens zurück. So braucht Vercel nur DATABASE_URL/DIRECT_URL,
 * der Rest (OpenAI, Google, Telegram) liegt in Supabase und ist ohne Redeploy änderbar.
 */
import { prisma } from "./db";

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
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    CACHE.delete(key);
    saved.push(key);
  }
  return saved;
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
    out[key] = { set: !!value, source, hint: value ? mask(value) : "" };
  }
  return out;
}

function mask(v: string): string {
  if (v.length <= 6) return "••••";
  return v.slice(0, 3) + "…" + v.slice(-3);
}
