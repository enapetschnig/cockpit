/**
 * "Gesehen" ist ein reiner Cockpit-Vermerk. Der fachliche Status
 * (umgesetzt/abgelehnt) wird weiterhin in der jeweiligen App gepflegt,
 * weil dort die Rückmeldung an den Melder dranhängt.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { gesehen?: boolean };
  const gesehen = b.gesehen !== false;

  const w = await prisma.appWunsch.findUnique({ where: { id }, select: { id: true } });
  if (!w) return NextResponse.json({ error: "nicht gefunden" }, { status: 404 });

  const updated = await prisma.appWunsch.update({
    where: { id },
    data: { gesehenAm: gesehen ? new Date() : null },
    select: { gesehenAm: true },
  });
  return NextResponse.json({ ok: true, gesehenAm: updated.gesehenAm?.toISOString() ?? null });
}
