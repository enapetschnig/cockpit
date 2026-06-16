import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftAdCopy, templateAdCopy, type AdCopyInput } from "@/lib/openai";
import { toAdDraftDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LocationInput = { type: string; key?: string; name?: string; radiusKm?: number; latitude?: number; longitude?: number };
type InterestInput = { id: string; name?: string };

// POST /api/ads/draft -> erstellt einen Entwurf (Text via Vorlage oder KI), inkl. Targeting
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
    locations?: LocationInput[];
    interests?: InterestInput[];
    gender?: string;
    ageMin?: number;
    ageMax?: number;
    tone?: string;
    styleSample?: string;
  };
  if (!b.adAccountId || !b.offer?.trim() || !b.region?.trim()) {
    return NextResponse.json({ error: "adAccountId, offer und region nötig" }, { status: 400 });
  }
  const acc = await prisma.adAccount.findUnique({ where: { id: b.adAccountId } });
  if (!acc) return NextResponse.json({ error: "Werbekonto nicht gefunden" }, { status: 404 });

  const locations = Array.isArray(b.locations) ? b.locations : [];
  const interests = Array.isArray(b.interests) ? b.interests : [];
  const firstCity = locations.find((l) => l.type === "city" || l.type === "region")?.name;
  const tone = b.tone === "sie" ? "sie" : "du";

  const input: AdCopyInput = {
    goal: b.goal || "leads",
    offer: b.offer.trim(),
    region: b.region.trim(),
    city: firstCity,
    benefit: b.benefit?.trim() || undefined,
    destination: b.destination === "website" ? "website" : "lead_form",
    tone,
    styleSample: b.styleSample?.trim() || undefined,
  };
  const copy = b.mode === "ki" ? await draftAdCopy(input) : templateAdCopy(input);

  const ageMin = Number(b.ageMin) >= 18 ? Math.round(Number(b.ageMin)) : 25;
  const ageMaxRaw = Number(b.ageMax);
  const ageMax = ageMaxRaw >= ageMin ? Math.round(ageMaxRaw) : 65;

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
      gender: b.gender === "men" || b.gender === "women" ? b.gender : null,
      ageMin,
      ageMax,
      tone,
      locationsJson: JSON.stringify(locations),
      interestsJson: JSON.stringify(interests),
      headline: copy.headline,
      primaryText: copy.primaryText,
      creativeNote: copy.creativeNote,
      questionsJson: JSON.stringify(copy.questions),
      status: "needs_review",
    },
  });
  return NextResponse.json(toAdDraftDTO(draft));
}
