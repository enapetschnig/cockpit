import { NextResponse } from "next/server";
import { configStatus, setConfigs, SETTING_KEYS } from "@/lib/config";

export const dynamic = "force-dynamic";

// Status der Keys (maskiert – nie der volle Wert!)
export async function GET() {
  return NextResponse.json({ keys: SETTING_KEYS, status: await configStatus() });
}

// Keys speichern (leere Felder werden ignoriert, überschreiben also nichts).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const saved = await setConfigs(body || {});
  return NextResponse.json({ saved, status: await configStatus() });
}
