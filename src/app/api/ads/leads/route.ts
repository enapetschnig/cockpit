import { NextResponse } from "next/server";
import { listLeads } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

// GET /api/ads/leads?accountId= -> echte Sofortformular-Leads (sofern Berechtigung)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  if (!accountId) return NextResponse.json({ error: "accountId nötig" }, { status: 400 });
  try {
    const data = await listLeads(accountId, 50);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ leads: [], totalForms: 0, note: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
