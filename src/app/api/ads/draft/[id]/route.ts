import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftAdCopy, templateAdCopy, type AdCopyInput } from "@/lib/openai";
import { toAdDraftDTO } from "@/lib/serialize";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeArr<T>(s: string): T[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? (a as T[]) : [];
  } catch {
    return [];
  }
}

// PATCH /api/ads/draft/[id] -> manuelle Edits speichern und/oder Text neu generieren
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const existing = await prisma.adDraft.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Entwurf nicht gefunden" }, { status: 404 });

  const data: Prisma.AdDraftUpdateInput = {};
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined);

  if (str("headline") !== undefined) data.headline = str("headline");
  if (str("primaryText") !== undefined) data.primaryText = str("primaryText");
  if (str("creativeNote") !== undefined) data.creativeNote = str("creativeNote");
  if (str("offer") !== undefined) data.offer = str("offer")!;
  if (str("region") !== undefined) data.region = str("region")!;
  if (str("goal") !== undefined) data.goal = str("goal")!;
  if (str("benefit") !== undefined) data.benefit = str("benefit") || null;
  if (str("destination") !== undefined) data.destination = b.destination === "website" ? "website" : "lead_form";
  if (str("websiteUrl") !== undefined) data.websiteUrl = str("websiteUrl") || null;
  if (str("privacyUrl") !== undefined) data.privacyUrl = str("privacyUrl") || null;
  if (str("imageUrl") !== undefined) data.imageUrl = str("imageUrl") || null;
  if (b.budget !== undefined) {
    const nb = Number(b.budget);
    if (Number.isFinite(nb) && nb > 0) data.budget = Math.round(nb);
  }
  if (Array.isArray(b.questions)) data.questionsJson = JSON.stringify((b.questions as unknown[]).map(String).filter(Boolean));

  // Targeting-Edits
  if (Array.isArray(b.locations)) data.locationsJson = JSON.stringify(b.locations);
  if (Array.isArray(b.interests)) data.interestsJson = JSON.stringify(b.interests);
  if (str("gender") !== undefined) data.gender = b.gender === "men" || b.gender === "women" ? (b.gender as string) : null;
  if (str("tone") !== undefined) data.tone = b.tone === "sie" ? "sie" : "du";
  if (b.ageMin !== undefined) {
    const n = Number(b.ageMin);
    if (Number.isFinite(n) && n >= 18) data.ageMin = Math.round(n);
  }
  if (b.ageMax !== undefined) {
    const n = Number(b.ageMax);
    if (Number.isFinite(n) && n >= 18) data.ageMax = Math.round(n);
  }

  // Optional: Text neu generieren ("ki" | "vorlage")
  if (b.regenerate === "ki" || b.regenerate === "vorlage") {
    const locs = (Array.isArray(b.locations) ? b.locations : safeArr(existing.locationsJson)) as { type?: string; name?: string }[];
    const firstCity = locs.find((l) => l.type === "city" || l.type === "region")?.name;
    const input: AdCopyInput = {
      goal: (str("goal") ?? existing.goal) || "leads",
      offer: str("offer") ?? existing.offer,
      region: str("region") ?? existing.region,
      city: firstCity,
      benefit: (str("benefit") ?? existing.benefit) || undefined,
      destination: (str("destination") ?? existing.destination) === "website" ? "website" : "lead_form",
      tone: (str("tone") ?? existing.tone) === "sie" ? "sie" : "du",
      styleSample: str("styleSample") || undefined,
    };
    const copy = b.regenerate === "ki" ? await draftAdCopy(input) : templateAdCopy(input);
    data.headline = copy.headline;
    data.primaryText = copy.primaryText;
    data.creativeNote = copy.creativeNote;
    data.questionsJson = JSON.stringify(copy.questions);
  }

  // Nach Edit wieder als prüfbar markieren (falls vorher fehlerhaft gelauncht)
  if (existing.status === "launch_error") data.status = "needs_review";

  const draft = await prisma.adDraft.update({ where: { id }, data });
  return NextResponse.json(toAdDraftDTO(draft));
}

// DELETE /api/ads/draft/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.adDraft.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
