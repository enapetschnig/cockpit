import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signedDownloadUrl } from "@/lib/adsStorage";
import { uploadVideoFromUrl } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/video/attach { accountId, draftId?, path, filename }
// Gibt Meta die Download-URL des hochgeladenen Videos, speichert die video_id am Entwurf.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { accountId?: string; draftId?: string; path?: string; filename?: string };
  if (!b.accountId || !b.path) return NextResponse.json({ ok: false, error: "accountId und path nötig" }, { status: 400 });
  try {
    const url = await signedDownloadUrl(b.path, 1800);
    const { videoId, ready } = await uploadVideoFromUrl(b.accountId, url, b.filename || "Video");
    if (b.draftId) await prisma.adDraft.update({ where: { id: b.draftId }, data: { videoId } }).catch(() => {});
    return NextResponse.json({ ok: true, videoId, ready });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
