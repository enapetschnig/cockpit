import { NextResponse } from "next/server";
import { runBmdWorker } from "@/lib/bmd/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Manueller Trigger (z. B. von /buchhaltung). */
export async function POST() {
  return NextResponse.json(await runBmdWorker());
}

/**
 * Cron-Trigger (Vercel ruft per GET, alle 2 Min). Falls CRON_SECRET gesetzt ist,
 * muss der Authorization-Header passen (Vercel sendet "Bearer <CRON_SECRET>").
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runBmdWorker());
}
