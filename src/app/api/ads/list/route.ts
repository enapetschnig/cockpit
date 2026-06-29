import { NextResponse } from "next/server";
import { listAdsWithInsights } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/list?accountId=&since=&until=&active=1 -> einzelne Anzeigen (mit Vorschaubild)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const since = u.searchParams.get("since") || undefined;
  const until = u.searchParams.get("until") || undefined;
  const activeOnly = u.searchParams.get("active") === "1";
  try {
    const ads = await listAdsWithInsights(accountId, { since, until, activeOnly });
    return NextResponse.json({ ads });
  } catch (e) {
    return NextResponse.json({ ads: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
