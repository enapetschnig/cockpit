import { NextResponse } from "next/server";
import { listAdsWithInsights } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";
import { cacheKey, readCache, writeCache } from "@/lib/insightCache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/list?accountId=&since=&until=&preset=&active=1&refresh=1 -> einzelne Anzeigen
// Stale-While-Revalidate über den Supabase-Cache (siehe overview-Route).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const since = u.searchParams.get("since") || undefined;
  const until = u.searchParams.get("until") || undefined;
  const preset = u.searchParams.get("preset") || undefined;
  const activeOnly = u.searchParams.get("active") === "1";
  const refresh = u.searchParams.get("refresh") === "1";
  const key = cacheKey({ preset, since, until, activeOnly });

  if (!refresh) {
    const cached = await readCache<{ ads: unknown[] }>(accountId, "ads", key);
    if (cached) return NextResponse.json({ ...cached.payload, cachedAt: cached.fetchedAt, stale: cached.stale });
  }
  try {
    const ads = await listAdsWithInsights(accountId, { since, until, preset, activeOnly });
    await writeCache(accountId, "ads", key, { ads });
    return NextResponse.json({ ads, cachedAt: null, stale: false });
  } catch (e) {
    const cached = await readCache<{ ads: unknown[] }>(accountId, "ads", key);
    if (cached) return NextResponse.json({ ...cached.payload, cachedAt: cached.fetchedAt, stale: true });
    return NextResponse.json({ ads: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
