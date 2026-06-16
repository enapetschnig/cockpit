/**
 * Supabase Storage – Server-Client (Service-Role) für den privaten Bucket "belege".
 * Der Browser-Client (client.ts) nutzt den anon-Key und darf NICHT schreiben.
 * Keys kommen aus der Config (Setting/Env): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "../config";

export const BELEGE_BUCKET = "belege";

let cached: SupabaseClient | null = null;

async function storage(): Promise<SupabaseClient> {
  if (cached) return cached;
  const url = (await getConfig("SUPABASE_URL")) || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = (await getConfig("SUPABASE_SERVICE_ROLE_KEY")) || "";
  if (!url || !key) {
    throw new Error("Supabase Storage nicht konfiguriert: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (unter /connect → Einstellungen).");
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

/** Legt den privaten Bucket "belege" an, falls er noch nicht existiert (idempotent). */
export async function ensureBucket(): Promise<void> {
  const sb = await storage();
  const { data } = await sb.storage.getBucket(BELEGE_BUCKET);
  if (data) return;
  const { error } = await sb.storage.createBucket(BELEGE_BUCKET, { public: false });
  // "already exists" race ignorieren
  if (error && !/exist/i.test(error.message)) throw error;
}

/** Lädt Bytes in den Bucket. Pfad z. B. "rechnung/2026-06/<sha>-Invoice.pdf". */
export async function uploadBeleg(path: string, bytes: Uint8Array, contentType = "application/pdf"): Promise<void> {
  const sb = await storage();
  await ensureBucket();
  const { error } = await sb.storage.from(BELEGE_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}

/** Kurzlebige Signed-URL (Default 30 Min) zum Ansehen/Weitergeben (z. B. an browser-use). */
export async function signedUrl(path: string, ttlSeconds = 1800): Promise<string> {
  const sb = await storage();
  const { data, error } = await sb.storage.from(BELEGE_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) throw error || new Error("Signed-URL fehlgeschlagen");
  return data.signedUrl;
}

/** Ob der Storage konfiguriert ist (für die UI / sanftes Degradieren). */
export async function isStorageConfigured(): Promise<boolean> {
  const url = (await getConfig("SUPABASE_URL")) || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = (await getConfig("SUPABASE_SERVICE_ROLE_KEY")) || "";
  return Boolean(url && key);
}
