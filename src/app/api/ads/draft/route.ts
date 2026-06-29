import { NextResponse } from "next/server";
import { draftAdCopy, templateAdCopy, type AdCopyInput } from "@/lib/openai";
import { toAdDraftDTO } from "@/lib/serialize";
import { requireAccountAccess } from "@/lib/authz";
import { prisma } from "@/lib/db";

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
    details?: string;
    questions?: string[];
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
    leadFormId?: string;
  };
  if (!b.adAccountId || !b.offer?.trim() || !b.region?.trim()) {
    return NextResponse.json({ error: "adAccountId, offer und region nötig" }, { status: 400 });
  }
  const access = await requireAccountAccess(b.adAccountId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const acc = access.account;

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
    details: b.details?.trim() || undefined,
    destination: b.destination === "website" ? "website" : "lead_form",
    tone,
    styleSample: b.styleSample?.trim() || undefined,
  };
  const copy = b.mode === "ki" ? await draftAdCopy(input) : templateAdCopy(input);
  // Vom Nutzer gewählte Formularfragen haben Vorrang vor den KI-Fragen.
  const userQuestions = Array.isArray(b.questions) ? b.questions.map((q) => String(q).trim()).filter(Boolean) : [];
  const questions = userQuestions.length ? userQuestions : copy.questions;

  const ageMin = Number(b.ageMin) >= 18 ? Math.round(Number(b.ageMin)) : 25;
  const ageMaxRaw = Number(b.ageMax);
  const ageMax = ageMaxRaw >= ageMin ? Math.round(ageMaxRaw) : 65;

  const draft = await prisma.adDraft.create({
    data: {
      adAccountId: acc.id,
      createdBy: access.user.userId,
      goal: input.goal,
      offer: input.offer,
      region: input.region,
      benefit: input.benefit ?? null,
      details: input.details ?? null,
      budget: Number(b.budget) > 0 ? Math.round(Number(b.budget)) : 20,
      destination: input.destination!,
      websiteUrl: b.websiteUrl?.trim() || null,
      privacyUrl: b.privacyUrl?.trim() || null,
      imageUrl: b.imageUrl?.trim() || null,
      gender: b.gender === "men" || b.gender === "women" ? b.gender : null,
      ageMin,
      ageMax,
      tone,
      leadFormId: b.leadFormId?.trim() || null,
      locationsJson: JSON.stringify(locations),
      interestsJson: JSON.stringify(interests),
      headline: copy.headline,
      primaryText: copy.primaryText,
      creativeNote: copy.creativeNote,
      questionsJson: JSON.stringify(questions),
      status: "needs_review",
    },
  });
  return NextResponse.json(toAdDraftDTO(draft));
}
