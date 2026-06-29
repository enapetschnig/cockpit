import { NextResponse } from "next/server";
import { fetchOverview } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/overview?accountId=&since=YYYY-MM-DD&until=YYYY-MM-DD&active=1
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  if (!accountId) return NextResponse.json({ error: "accountId nötig" }, { status: 400 });
  const since = u.searchParams.get("since") || undefined;
  const until = u.searchParams.get("until") || undefined;
  const activeOnly = u.searchParams.get("active") === "1";
  try {
    const data = await fetchOverview(accountId, { since, until, activeOnly });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), totals: null, campaigns: [] }, { status: 200 });
  }
}
