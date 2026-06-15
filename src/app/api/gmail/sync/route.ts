import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/gmail";
import { runSync } from "@/lib/gmailSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Manueller Sync (Button auf /connect). Holt neue Mails, klassifiziert, speichert, pusht. */
export async function POST() {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Gmail nicht konfiguriert (GOOGLE_CLIENT_ID/SECRET fehlen)." }, { status: 503 });
  }
  const res = await runSync();
  return NextResponse.json(res);
}
