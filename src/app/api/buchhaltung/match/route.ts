import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toBuchungDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/**
 * Manuelle Zuordnung einer Buchung:
 *  - { buchungId, belegId }       -> Rechnung zuordnen
 *  - { buchungId, belegId: null } -> Zuordnung lösen (zurück auf unmatched)
 *  - { buchungId, ignore: true }  -> Buchung ignorieren
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const buchungId = body?.buchungId as string | undefined;
  if (!buchungId) return NextResponse.json({ error: "buchungId fehlt" }, { status: 400 });

  const buchung = await prisma.buchung.findUnique({ where: { id: buchungId } });
  if (!buchung) return NextResponse.json({ error: "Buchung nicht gefunden" }, { status: 404 });

  if (body.ignore) {
    const u = await prisma.buchung.update({ where: { id: buchungId }, data: { matchStatus: "ignored", matchedBelegId: null } });
    return NextResponse.json(toBuchungDTO(u));
  }

  // Zuordnung lösen
  if (body.belegId === null || body.belegId === "") {
    const u = await prisma.buchung.update({
      where: { id: buchungId },
      data: { matchStatus: "unmatched", matchedBelegId: null, matchConfidence: null },
    });
    return NextResponse.json(toBuchungDTO(u));
  }

  const belegId = body.belegId as string | undefined;
  if (!belegId) return NextResponse.json({ error: "belegId fehlt" }, { status: 400 });

  const beleg = await prisma.beleg.findUnique({ where: { id: belegId } });
  if (!beleg || beleg.kind !== "rechnung") return NextResponse.json({ error: "Rechnung nicht gefunden" }, { status: 404 });

  // Schon einer anderen Buchung zugeordnet?
  const claimedBy = await prisma.buchung.findFirst({
    where: { matchedBelegId: belegId, matchStatus: "matched", id: { not: buchungId } },
  });
  if (claimedBy) return NextResponse.json({ error: "Rechnung bereits zugeordnet" }, { status: 409 });

  const u = await prisma.buchung.update({
    where: { id: buchungId },
    data: { matchedBelegId: belegId, matchStatus: "matched", matchConfidence: null },
  });
  return NextResponse.json(toBuchungDTO(u));
}
