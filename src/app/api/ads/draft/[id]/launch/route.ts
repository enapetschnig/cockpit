import { NextResponse } from "next/server";
import { launchDraftToMeta } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/draft/[id]/launch -> erstellt die Kampagne PAUSIERT in Meta
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await launchDraftToMeta(id);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    // 200 mit ok:false – der Fehler ist eine fachliche Meta-Rückmeldung (im Draft gespeichert)
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
