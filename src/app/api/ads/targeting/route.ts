import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { searchLocations, searchInterests } from "@/lib/meta";
import { getSessionUser, accountScope, requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/ads/targeting?kind=location|interest&q=…&accountId=…
// Sucht Orte/Interessen LIVE über die Meta Targeting-Suche (adgeolocation/adinterest).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "location";
  const q = url.searchParams.get("q") || "";
  let accountId = url.searchParams.get("accountId") || "";

  if (accountId) {
    const access = await requireAccountAccess(accountId);
    if (!access.ok) return NextResponse.json({ results: [], error: access.error }, { status: access.status });
  } else {
    // Kein Konto angegeben → erstes Konto des Users (Admin: irgendeins) nehmen.
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ results: [], error: "Nicht angemeldet" }, { status: 401 });
    const first = await prisma.adAccount.findFirst({ where: { ...accountScope(user), tokenCipher: { not: null }, status: "connected" }, orderBy: { createdAt: "asc" } });
    if (!first) return NextResponse.json({ results: [], error: "Kein verbundenes Werbekonto." }, { status: 200 });
    accountId = first.id;
  }

  try {
    const results = kind === "interest" ? await searchInterests(accountId, q) : await searchLocations(accountId, q);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ results: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
