import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/gmail";
import { runSync } from "@/lib/gmailSync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function doSync() {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Gmail nicht konfiguriert (GOOGLE_CLIENT_ID/SECRET fehlen)." }, { status: 503 });
  }
  return NextResponse.json(await runSync());
}

/** Manueller Sync (Button auf /connect, Sync beim Öffnen). */
export async function POST() {
  return doSync();
}

/**
 * Cron-Trigger – Vercel Cron ruft den Pfad per GET auf.
 * Falls CRON_SECRET gesetzt ist, muss der Authorization-Header passen
 * (Vercel sendet automatisch "Bearer <CRON_SECRET>").
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return doSync();
}
