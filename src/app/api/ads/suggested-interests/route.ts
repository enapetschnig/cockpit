import { NextResponse } from "next/server";
import { suggestedInterests } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/suggested-interests?accountId= -> bewährte Interessen (nach Leads gewichtet)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ error: access.error, interests: [] }, { status: access.status });
  try {
    const interests = await suggestedInterests(accountId);
    return NextResponse.json({ interests });
  } catch (e) {
    return NextResponse.json({ interests: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
