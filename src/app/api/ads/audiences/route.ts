import { NextResponse } from "next/server";
import { listSavedAudiences } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/audiences?accountId= -> gespeicherte Zielgruppen (zum Übernehmen)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  if (!accountId) return NextResponse.json({ error: "accountId nötig" }, { status: 400 });
  try {
    const audiences = await listSavedAudiences(accountId);
    return NextResponse.json({ audiences });
  } catch (e) {
    return NextResponse.json({ audiences: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
