import { NextResponse } from "next/server";
import { listLeadForms } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/forms?accountId= -> bestehende Lead-Formulare (zum Wiederverwenden)
export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get("accountId") || "";
  if (!accountId) return NextResponse.json({ error: "accountId nötig" }, { status: 400 });
  try {
    const forms = await listLeadForms(accountId);
    return NextResponse.json({ forms });
  } catch (e) {
    return NextResponse.json({ forms: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
