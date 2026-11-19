import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { firmenZugangsToken } from "@/lib/gmail";

export const dynamic = "force-dynamic";

/**
 * Zugang zum Firmen-Postfach (hallo@) für den Mail-Abholer am PC (_baukasten/werkzeuge/mail-wuensche).
 * Seit das Postfach über das Dienstkonto läuft, hat der PC kein gültiges Refresh-Token mehr – er holt sich hier
 * ein Token für eine Stunde. Der Dienstkonto-Schlüssel bleibt auf Vercel.
 *
 * Schutz: Header "Authorization: Bearer <ROBOTER_MAIL_SCHLUESSEL>" (Setting-Tabelle, nur per Datenbank lesbar),
 * zeitkonstant verglichen. Ohne Eintrag bleibt die Route zu.
 */
export async function POST(req: Request) {
  const eintrag = await prisma.setting.findUnique({ where: { key: "ROBOTER_MAIL_SCHLUESSEL" } });
  const h = (s: string) => createHash("sha256").update(s).digest();
  if (!eintrag?.value || !timingSafeEqual(h(req.headers.get("authorization") || ""), h(`Bearer ${eintrag.value}`))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const z = await firmenZugangsToken();
    if (!z) return NextResponse.json({ error: "Dienstkonto nicht eingerichtet" }, { status: 503 });
    return NextResponse.json(z, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}
