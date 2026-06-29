/**
 * Stale-While-Revalidate-Cache für Meta-Kennzahlen (Overview/Ads) pro Konto+Zeitraum.
 * Das Dashboard liest sofort aus Supabase und holt nur bei Bedarf (stale/refresh) live.
 */
import { prisma } from "@/lib/db";

export const CACHE_TTL_MS = 12 * 60 * 1000; // 12 Minuten gilt der Cache als frisch

// Stabiler Schlüssel aus Zeitraum-Parametern (+ Aktiv-Filter).
export function cacheKey(opts: { preset?: string; since?: string; until?: string; activeOnly?: boolean }): string {
  const base = opts.preset ? `p:${opts.preset}` : `r:${opts.since || ""}_${opts.until || ""}`;
  return `${base}|a:${opts.activeOnly ? 1 : 0}`;
}

export async function readCache<T>(adAccountId: string, kind: string, rangeKey: string): Promise<{ payload: T; stale: boolean; fetchedAt: string } | null> {
  const row = await prisma.adInsightCache.findUnique({ where: { adAccountId_kind_rangeKey: { adAccountId, kind, rangeKey } } }).catch(() => null);
  if (!row) return null;
  let payload: T;
  try {
    payload = JSON.parse(row.payloadJson) as T;
  } catch {
    return null;
  }
  return { payload, stale: Date.now() - row.fetchedAt.getTime() > CACHE_TTL_MS, fetchedAt: row.fetchedAt.toISOString() };
}

export async function writeCache(adAccountId: string, kind: string, rangeKey: string, payload: unknown): Promise<void> {
  const payloadJson = JSON.stringify(payload);
  await prisma.adInsightCache
    .upsert({
      where: { adAccountId_kind_rangeKey: { adAccountId, kind, rangeKey } },
      create: { adAccountId, kind, rangeKey, payloadJson },
      update: { payloadJson },
    })
    .catch(() => {});
}
