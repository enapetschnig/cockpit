import { NextResponse } from "next/server";
import { syncAdLeadsToCrm } from "@/lib/crmLeadSync";
import { getSessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Werbekonten, deren Leads automatisch ins CRM wandern (+ CRM-Besitzer)
const SOURCES = [
  { metaAccountId: "act_240480832228461", owner: "83edc9c7-26a7-4f56-8806-cdfe253b9751" }, // Christoph Werbung
];

async function run(sinceDays: number) {
  const results = [];
  for (const s of SOURCES) {
    try {
      results.push(await syncAdLeadsToCrm(s.metaAccountId, s.owner, sinceDays));
    } catch (e) {
      results.push({ account: s.metaAccountId, found: 0, created: 0, note: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// GET – vom Cron aufgerufen (CRON_SECRET), holt die Leads der letzten Tage
export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET;
  const u = new URL(req.url);
  const ok = cron && (req.headers.get("authorization") === `Bearer ${cron}` || u.searchParams.get("key") === cron);
  if (!ok) {
    // Ohne Cron-Schlüssel: nur für eingeloggte Admins
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const days = Math.min(365, Math.max(1, Number(u.searchParams.get("days")) || 14));
  const results = await run(days);
  return NextResponse.json({ ok: true, results });
}

// POST – manueller Anstoß aus der App (auch für einen längeren Zeitraum)
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { days?: number };
  const results = await run(Math.min(365, Math.max(1, Number(b.days) || 90)));
  return NextResponse.json({ ok: true, results });
}
