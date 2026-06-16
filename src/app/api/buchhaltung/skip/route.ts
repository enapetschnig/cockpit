import { NextResponse } from "next/server";
import { skipBeleg } from "@/lib/bmd/state";
import { toBelegDTO } from "@/lib/serialize";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Beleg ignorieren (nicht ans BMD). { belegId } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const belegId = body?.belegId as string | undefined;
  if (!belegId) return NextResponse.json({ error: "belegId fehlt" }, { status: 400 });
  const exists = await prisma.beleg.findUnique({ where: { id: belegId } });
  if (!exists) return NextResponse.json({ error: "Beleg nicht gefunden" }, { status: 404 });
  const b = await skipBeleg(belegId);
  return NextResponse.json(toBelegDTO(b!));
}
