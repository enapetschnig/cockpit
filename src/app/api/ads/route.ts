import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toAdAccountDTO, toAdCampaignDTO, toAdDraftDTO } from "@/lib/serialize";
import { campaignHealth, campaignSortKey, dashboardRecommendations } from "@/lib/meta";

export const dynamic = "force-dynamic";

// GET /api/ads -> Konten + Kampagnen (mit Ampel) + Entwürfe + Empfehlungen
export async function GET() {
  const [accounts, campaigns, drafts] = await Promise.all([
    prisma.adAccount.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.adCampaign.findMany(),
    prisma.adDraft.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const withHealth = campaigns.map((c) => ({
    c,
    health: campaignHealth({ effectiveStatus: c.effectiveStatus, spend: c.spend, clicks: c.clicks, leads: c.leads, cpa: c.cpa, ctr: c.ctr }),
  }));
  withHealth.sort((a, b) =>
    campaignSortKey({ health: a.health, spend: a.c.spend, name: a.c.name }, { health: b.health, spend: b.c.spend, name: b.c.name })
  );

  return NextResponse.json({
    accounts: accounts.map(toAdAccountDTO),
    campaigns: withHealth.map(({ c, health }) => toAdCampaignDTO(c, health)),
    drafts: drafts.map(toAdDraftDTO),
    recommendations: dashboardRecommendations(withHealth.map(({ c, health }) => ({ name: c.name, health, cpa: c.cpa }))),
  });
}
