import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toAdAccountDTO, toAdCampaignDTO, toAdDraftDTO } from "@/lib/serialize";
import { campaignHealth, campaignSortKey, dashboardRecommendations } from "@/lib/meta";
import { getSessionUser, accountScope } from "@/lib/authz";

export const dynamic = "force-dynamic";

// GET /api/ads -> NUR die Konten des Users (Admin: alle) + deren Kampagnen + Entwürfe
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const scope = accountScope(user); // {} für Admin, sonst { ownerUserId }

  const accounts = await prisma.adAccount.findMany({ where: scope, orderBy: { createdAt: "asc" } });
  const accountIds = accounts.map((a) => a.id);
  const [campaigns, drafts] = await Promise.all([
    prisma.adCampaign.findMany({ where: { adAccountId: { in: accountIds } } }),
    prisma.adDraft.findMany({ where: { adAccountId: { in: accountIds } }, orderBy: { createdAt: "desc" }, take: 50 }),
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
