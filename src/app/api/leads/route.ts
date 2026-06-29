import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toLeadDTO } from "@/lib/serialize";
import { requireAccountAccess } from "@/lib/authz";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// GET /api/leads?accountId=&status= -> persistierte Leads (CRM), scoped
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ error: access.error, leads: [] }, { status: access.status });

  const where: Prisma.LeadWhereInput = { adAccountId: accountId };
  const status = u.searchParams.get("status");
  if (status && status !== "alle") where.status = status;

  const leads = await prisma.lead.findMany({
    where,
    include: { activities: { orderBy: { createdAt: "desc" } } },
    orderBy: { receivedAt: "desc" },
    take: 300,
  });
  // Statuszähler für die Filter-Pills
  const grouped = await prisma.lead.groupBy({ by: ["status"], where: { adAccountId: accountId }, _count: true });
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count;
  // ungesehene (neu eingegangene) Leads
  const unseen = await prisma.lead.count({ where: { adAccountId: accountId, seenAt: null } });

  return NextResponse.json({ leads: leads.map(toLeadDTO), counts, unseen });
}
