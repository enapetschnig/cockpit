import { NextResponse } from "next/server";
import { listLeads } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

// GET /api/ads/leads?accountId= -> echte Sofortformular-Leads (sofern Berechtigung)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const data = await listLeads(accountId, 50);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ leads: [], totalForms: 0, note: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
