/** Kunde bearbeiten – aktuell die Zuordnung zur Handwerker-App (appKey). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appInfo } from "@/lib/apps";
import { toCustomerDTO } from "@/lib/serialize";
import { getSessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { appKey?: string | null };

  const data: { appKey?: string | null } = {};
  if ("appKey" in b) {
    const key = (b.appKey ?? "").toString().trim();
    if (key && !appInfo(key)) return NextResponse.json({ error: `App "${key}" ist nicht hinterlegt` }, { status: 400 });
    // Der appKey ist eindeutig – vorher beim bisherigen Kunden lösen.
    if (key) await prisma.customer.updateMany({ where: { appKey: key, NOT: { id } }, data: { appKey: null } });
    data.appKey = key || null;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "nichts zu ändern" }, { status: 400 });

  const c = await prisma.customer.update({ where: { id }, data, include: { todos: true, emails: true } });

  // Bereits eingegangene Wünsche dieser App nachträglich zuordnen.
  if (data.appKey) {
    await prisma.appWunsch.updateMany({ where: { appKey: data.appKey, customerId: null }, data: { customerId: c.id } });
  }

  const offen = await prisma.appWunsch.count({ where: { customerId: c.id, gesehenAm: null } });
  return NextResponse.json(toCustomerDTO(c, offen));
}
