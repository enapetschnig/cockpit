import { NextResponse } from "next/server";
import { queueBeleg, approveAllCollected } from "@/lib/bmd/state";
import { toBelegDTO } from "@/lib/serialize";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Gibt einen Beleg (oder alle) zum BMD-Upload frei (status=queued).
 *  - { belegId }   -> einen Beleg
 *  - { all: true } -> alle gesammelten/fehlgeschlagenen
 * Der Worker-Cron lädt anschließend asynchron hoch.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  if (body?.all) {
    const count = await approveAllCollected("app");
    return NextResponse.json({ queued: count });
  }

  const belegId = body?.belegId as string | undefined;
  if (!belegId) return NextResponse.json({ error: "belegId fehlt" }, { status: 400 });
  const exists = await prisma.beleg.findUnique({ where: { id: belegId } });
  if (!exists) return NextResponse.json({ error: "Beleg nicht gefunden" }, { status: 404 });

  const b = await queueBeleg(belegId, "app");
  return NextResponse.json(toBelegDTO(b!));
}
