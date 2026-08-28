/** Arbeitsliste der Wünsche – alle Apps, neueste zuerst. Nur für Eingeloggte. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appLabel } from "@/lib/apps";
import { getSessionUser } from "@/lib/authz";
import type { WunschDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const u = new URL(req.url);
  const appKey = u.searchParams.get("app");
  const art = u.searchParams.get("art");
  const status = u.searchParams.get("status");

  const wuensche = await prisma.appWunsch.findMany({
    where: {
      ...(appKey ? { appKey } : {}),
      ...(art ? { art } : {}),
      ...(status === "offen" ? { gesehenAm: null } : status ? { status } : {}),
    },
    orderBy: { erstelltAm: "desc" },
    take: 300,
    include: { customer: { select: { id: true, name: true, color: true } } },
  });

  const items: WunschDTO[] = wuensche.map((w) => ({
    id: w.id,
    appKey: w.appKey,
    appLabel: appLabel(w.appKey),
    kunde: w.customer?.name ?? null,
    kundeFarbe: w.customer?.color ?? null,
    art: w.art,
    status: w.status,
    text: w.text,
    antwort: w.antwort,
    seite: w.seite,
    melder: w.melder,
    hatBild: !!w.bildPfad,
    hatAudio: !!w.audioPfad,
    erstelltAm: w.erstelltAm.toISOString(),
    aktualisiert: w.aktualisiert.toISOString(),
    gesehenAm: w.gesehenAm?.toISOString() ?? null,
  }));

  // Zähler über den GESAMTEN Bestand, nicht nur über die gefilterte Liste.
  const [neu, gesamt, proApp] = await Promise.all([
    prisma.appWunsch.count({ where: { gesehenAm: null } }),
    prisma.appWunsch.count(),
    prisma.appWunsch.groupBy({ by: ["appKey"], _count: { _all: true }, where: { gesehenAm: null } }),
  ]);

  return NextResponse.json({
    items,
    neu,
    gesamt,
    proApp: Object.fromEntries(proApp.map((r) => [r.appKey, r._count._all])),
  });
}
