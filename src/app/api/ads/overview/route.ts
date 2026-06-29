import { NextResponse } from "next/server";
import { fetchOverview } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/overview?accountId=&since=YYYY-MM-DD&until=YYYY-MM-DD&active=1
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const since = u.searchParams.get("since") || undefined;
  const until = u.searchParams.get("until") || undefined;
  const preset = u.searchParams.get("preset") || undefined;
  const activeOnly = u.searchParams.get("active") === "1";
  try {
    const data = await fetchOverview(accountId, { since, until, preset, activeOnly });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), totals: null, campaigns: [] }, { status: 200 });
  }
}
