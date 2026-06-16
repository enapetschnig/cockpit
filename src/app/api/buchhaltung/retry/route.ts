import { NextResponse } from "next/server";
import { retryBeleg } from "@/lib/bmd/state";
import { toBelegDTO } from "@/lib/serialize";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Nochmal an BMD senden (nur aus failed/needs_review). { belegId } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const belegId = body?.belegId as string | undefined;
  if (!belegId) return NextResponse.json({ error: "belegId fehlt" }, { status: 400 });
  const exists = await prisma.beleg.findUnique({ where: { id: belegId } });
  if (!exists) return NextResponse.json({ error: "Beleg nicht gefunden" }, { status: 404 });
  const b = await retryBeleg(belegId);
  return NextResponse.json(toBelegDTO(b!));
}
