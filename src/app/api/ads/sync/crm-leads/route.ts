import { createHash, timingSafeEqual } from "node:crypto";
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

/**
 * Cron-Schlüssel NUR per Header "Authorization: Bearer <CRON_SECRET>" (kein ?key= – der landet in
 * Logs), zeitkonstant verglichen. Ohne CRON_SECRET bleibt die Route zu (die Middleware lässt sie durch).
 */
function cronErlaubt(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(req.headers.get("authorization") || ""), h(`Bearer ${secret}`));
}

// GET – vom Vercel-Cron aufgerufen (CRON_SECRET), holt die Leads der letzten Tage
export async function GET(req: Request) {
  if (!cronErlaubt(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url);
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
