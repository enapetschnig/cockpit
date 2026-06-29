import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signedDownloadUrl } from "@/lib/adsStorage";
import { uploadVideoFromUrl } from "@/lib/meta";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/video/attach { accountId, draftId?, path, filename }
// Gibt Meta die Download-URL des hochgeladenen Videos, speichert die video_id am Entwurf.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { accountId?: string; draftId?: string; path?: string; filename?: string };
  if (!b.accountId || !b.path) return NextResponse.json({ ok: false, error: "accountId und path nötig" }, { status: 400 });
  const access = await requireAccountAccess(b.accountId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  // Entwurf muss zum freigegebenen Konto gehören (kein Cross-Tenant-Write).
  if (b.draftId) {
    const draft = await prisma.adDraft.findUnique({ where: { id: b.draftId }, select: { adAccountId: true } });
    if (!draft || draft.adAccountId !== b.accountId) return NextResponse.json({ ok: false, error: "Entwurf gehört nicht zu diesem Konto" }, { status: 403 });
  }
  try {
    const url = await signedDownloadUrl(b.path, 1800);
    const { videoId, ready } = await uploadVideoFromUrl(b.accountId, url, b.filename || "Video");
    if (b.draftId) await prisma.adDraft.update({ where: { id: b.draftId }, data: { videoId } }).catch(() => {});
    return NextResponse.json({ ok: true, videoId, ready });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
