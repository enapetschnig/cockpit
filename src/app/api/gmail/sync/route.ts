import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isGmailConfigured } from "@/lib/gmail";
import { runSync } from "@/lib/gmailSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function doSync() {
  if (!(await isGmailConfigured())) {
    return NextResponse.json({ error: "Gmail nicht konfiguriert (Dienstkonto oder GOOGLE_CLIENT_ID/SECRET fehlen)." }, { status: 503 });
  }
  return NextResponse.json(await runSync());
}

/** Manueller Sync (Button auf /connect, Sync beim Öffnen) – braucht die Inhaber-Sitzung (Middleware). */
export async function POST() {
  return doSync();
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

// GET – vom Vercel-Cron aufgerufen (CRON_SECRET), alle 15 Minuten
export async function GET(req: Request) {
  if (!cronErlaubt(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return doSync();
}
