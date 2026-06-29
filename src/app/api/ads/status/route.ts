import { NextResponse } from "next/server";
import { setAdStatus } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/ads/status { accountId, adId, status: "ACTIVE" | "PAUSED" }
// Schaltet eine einzelne Anzeige live/pausiert. Pausieren = alle; Aktivieren = nur Admin
// (Kunden dürfen Anzeigen nicht selbst schalten – siehe Mandanten-Konzept).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { accountId?: string; adId?: string; status?: string };
  const accountId = (b.accountId ?? "").trim();
  const adId = (b.adId ?? "").trim();
  const status = b.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
  if (!adId) return NextResponse.json({ ok: false, error: "adId nötig" }, { status: 400 });

  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  if (status === "ACTIVE" && access.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Anzeigen aktivieren kann nur ePower – bitte zur Freigabe melden." }, { status: 403 });
  }

  try {
    const res = await setAdStatus(accountId, adId, status);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
