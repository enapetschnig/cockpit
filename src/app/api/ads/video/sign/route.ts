import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { signedUploadUrl } from "@/lib/adsStorage";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/ads/video/sign { accountId, filename } -> signierte Upload-URL für den Browser
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { accountId?: string; filename?: string };
  const access = await requireAccountAccess(b.accountId || "");
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const ext = (b.filename || "video.mp4").split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp4";
  const path = `${(b.accountId || "x").slice(0, 40)}/${randomUUID()}.${ext}`;
  try {
    const s = await signedUploadUrl(path);
    return NextResponse.json({ ok: true, ...s });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
