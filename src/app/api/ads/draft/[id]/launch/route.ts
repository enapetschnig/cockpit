import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { launchDraftToMeta } from "@/lib/meta";
import { getSessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/draft/[id]/launch -> erstellt die Kampagne PAUSIERT in Meta (nur Admin)
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ ok: false, error: "Nur der Admin kann Anzeigen schalten." }, { status: 403 });
  const draft = await prisma.adDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ ok: false, error: "Entwurf nicht gefunden" }, { status: 404 });
  try {
    const result = await launchDraftToMeta(id);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    // 200 mit ok:false – der Fehler ist eine fachliche Meta-Rückmeldung (im Draft gespeichert)
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
