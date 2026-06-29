import { NextResponse } from "next/server";
import { listSavedAudiences } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/audiences?accountId= -> gespeicherte Zielgruppen (zum Übernehmen)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const audiences = await listSavedAudiences(accountId);
    return NextResponse.json({ audiences });
  } catch (e) {
    return NextResponse.json({ audiences: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
