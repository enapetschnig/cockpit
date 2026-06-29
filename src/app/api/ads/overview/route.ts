import { NextResponse } from "next/server";
import { fetchOverview } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";
import { cacheKey, readCache, writeCache } from "@/lib/insightCache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/overview?accountId=&since=&until=&preset=&active=1&refresh=1
// Stale-While-Revalidate: ohne refresh kommt (falls vorhanden) der Supabase-Cache sofort;
// mit refresh=1 (oder leerem Cache) wird live von Meta geholt und der Cache aktualisiert.
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
    const cached = await readCache<{ totals: unknown; campaigns: unknown }>(accountId, "overview", key);
    if (cached) return NextResponse.json({ ...cached.payload, cachedAt: cached.fetchedAt, stale: cached.stale });
  }
  try {
    const data = await fetchOverview(accountId, { since, until, preset, activeOnly });
    await writeCache(accountId, "overview", key, data);
    return NextResponse.json({ ...data, cachedAt: null, stale: false });
  } catch (e) {
    // Bei Live-Fehler: lieber alten Cache zeigen als nichts.
    const cached = await readCache<{ totals: unknown; campaigns: unknown }>(accountId, "overview", key);
    if (cached) return NextResponse.json({ ...cached.payload, cachedAt: cached.fetchedAt, stale: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), totals: null, campaigns: [] }, { status: 200 });
  }
}
