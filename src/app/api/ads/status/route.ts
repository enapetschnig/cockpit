import { NextResponse } from "next/server";
import type { AdAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { setAdStatus } from "@/lib/meta";
import { decryptToken } from "@/lib/adsCrypto";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Gehört die Anzeige wirklich zu diesem (schon geprüften) Werbekonto? Sonst könnte man über den
 * Token des eigenen Kontos fremde Anzeigen schalten. Erst im Anzeigen-Cache des Kontos nachsehen
 * (/api/ads/list legt jede angezeigte Liste dort ab – kein Meta-Aufruf), sonst Meta fragen.
 */
async function gehoertZumKonto(account: AdAccount, adId: string): Promise<boolean> {
  const caches = await prisma.adInsightCache.findMany({ where: { adAccountId: account.id, kind: "ads" }, select: { payloadJson: true } });
  for (const c of caches) {
    try {
      const ads = (JSON.parse(c.payloadJson) as { ads?: { id?: unknown }[] }).ads ?? [];
      if (ads.some((a) => String(a.id) === adId)) return true;
    } catch {
      /* kaputter Cache-Eintrag → nächster */
    }
  }
  if (!account.tokenCipher) throw new Error("Kein Token hinterlegt – Konto erneut verbinden.");
  const qs = new URLSearchParams({ fields: "account_id", access_token: await decryptToken(account.tokenCipher) });
  const res = await fetch(`https://graph.facebook.com/v25.0/${adId}?${qs.toString()}`).catch(() => null);
  const j = res?.ok ? ((await res.json().catch(() => ({}))) as { account_id?: unknown }) : {};
  return j.account_id != null && String(j.account_id) === account.metaAccountId.replace(/^act_/, "");
}

// POST /api/ads/status { accountId, adId, status: "ACTIVE" | "PAUSED" }
// Schaltet eine einzelne Anzeige live/pausiert. Pausieren = alle; Aktivieren = nur Admin
// (Kunden dürfen Anzeigen nicht selbst schalten – siehe Mandanten-Konzept).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { accountId?: string; adId?: string; status?: string };
  const accountId = (b.accountId ?? "").trim();
  const adId = (b.adId ?? "").trim();
  const status = b.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
  if (!adId) return NextResponse.json({ ok: false, error: "adId nötig" }, { status: 400 });
  // Meta-IDs sind rein numerisch – alles andere würde als Graph-Pfad an Meta gehen.
  if (!/^\d+$/.test(adId)) return NextResponse.json({ ok: false, error: "adId ungültig" }, { status: 400 });

  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  if (status === "ACTIVE" && access.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Anzeigen aktivieren kann nur ePower – bitte zur Freigabe melden." }, { status: 403 });
  }

  try {
    if (!(await gehoertZumKonto(access.account, adId))) {
      return NextResponse.json({ ok: false, error: "Diese Anzeige gehört nicht zu diesem Werbekonto." }, { status: 403 });
    }
    const res = await setAdStatus(accountId, adId, status);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
