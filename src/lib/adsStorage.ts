/**
 * Supabase Storage für Werbe-Videos (Bucket "ads").
 * Browser lädt direkt per signierter Upload-URL hoch (umgeht das Vercel-Limit);
 * der Server gibt Meta dann eine kurzlebige Download-URL (file_url).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";

export const ADS_BUCKET = "ads";
let cached: SupabaseClient | null = null;

async function storage(): Promise<SupabaseClient> {
  if (cached) return cached;
  const url = (await getConfig("SUPABASE_URL")) || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = (await getConfig("SUPABASE_SERVICE_ROLE_KEY")) || "";
  if (!url || !key) throw new Error("Supabase Storage nicht konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

async function ensureBucket(): Promise<void> {
  const sb = await storage();
  const { data } = await sb.storage.getBucket(ADS_BUCKET);
  if (data) return;
  const { error } = await sb.storage.createBucket(ADS_BUCKET, { public: false });
  if (error && !/exist/i.test(error.message)) throw error;
}

/** Signierte Upload-URL, mit der der Browser die Datei direkt nach Supabase lädt. */
export async function signedUploadUrl(path: string): Promise<{ path: string; token: string; url: string }> {
  const sb = await storage();
  await ensureBucket();
  const { data, error } = await sb.storage.from(ADS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error || new Error("Upload-URL fehlgeschlagen");
  return { path: data.path, token: data.token, url: ADS_BUCKET };
}

/** Kurzlebige Download-URL, die Meta zum Abholen des Videos nutzt. */
export async function signedDownloadUrl(path: string, ttlSeconds = 1800): Promise<string> {
  const sb = await storage();
  const { data, error } = await sb.storage.from(ADS_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) throw error || new Error("Download-URL fehlgeschlagen");
  return data.signedUrl;
}
