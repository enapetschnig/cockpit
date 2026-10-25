import { NextResponse } from "next/server";
import { configStatus, setConfigs, SETTING_KEYS } from "@/lib/config";
import { getSessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

/** Hier liegen alle Schlüssel – nur der Inhaber (zusätzlich zur Middleware geprüft). */
async function keinInhaber(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  return user?.role === "admin" ? null : NextResponse.json({ error: "forbidden" }, { status: 403 });
}

// Status der Keys (maskiert – nie der volle Wert!)
export async function GET() {
  const nein = await keinInhaber();
  if (nein) return nein;
  return NextResponse.json({ keys: SETTING_KEYS, status: await configStatus() });
}

// Keys speichern (leere Felder werden ignoriert, überschreiben also nichts).
export async function POST(req: Request) {
  const nein = await keinInhaber();
  if (nein) return nein;
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const saved = await setConfigs(body || {});
  return NextResponse.json({ saved, status: await configStatus() });
}
