import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftAdCopy, templateAdCopy, type AdCopyInput } from "@/lib/openai";
import { toAdDraftDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/draft -> erstellt einen Entwurf (Text via Vorlage oder KI)
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    adAccountId?: string;
    goal?: string;
    offer?: string;
    region?: string;
    benefit?: string;
    budget?: number;
    destination?: string;
    websiteUrl?: string;
    privacyUrl?: string;
    imageUrl?: string;
    mode?: "ki" | "vorlage";
  };
  if (!b.adAccountId || !b.offer?.trim() || !b.region?.trim()) {
    return NextResponse.json({ error: "adAccountId, offer und region nötig" }, { status: 400 });
  }
  const acc = await prisma.adAccount.findUnique({ where: { id: b.adAccountId } });
  if (!acc) return NextResponse.json({ error: "Werbekonto nicht gefunden" }, { status: 404 });

  const input: AdCopyInput = {
    goal: b.goal || "leads",
    offer: b.offer.trim(),
    region: b.region.trim(),
    benefit: b.benefit?.trim() || undefined,
    destination: b.destination === "website" ? "website" : "lead_form",
  };
  const copy = b.mode === "ki" ? await draftAdCopy(input) : templateAdCopy(input);

  const draft = await prisma.adDraft.create({
    data: {
      adAccountId: acc.id,
      goal: input.goal,
      offer: input.offer,
      region: input.region,
      benefit: input.benefit ?? null,
      budget: Number(b.budget) > 0 ? Math.round(Number(b.budget)) : 20,
      destination: input.destination!,
      websiteUrl: b.websiteUrl?.trim() || null,
      privacyUrl: b.privacyUrl?.trim() || null,
      imageUrl: b.imageUrl?.trim() || null,
      headline: copy.headline,
      primaryText: copy.primaryText,
      creativeNote: copy.creativeNote,
      questionsJson: JSON.stringify(copy.questions),
      status: "needs_review",
    },
  });
  return NextResponse.json(toAdDraftDTO(draft));
}
