import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toLeadDTO } from "@/lib/serialize";
import { requireAccountAccess } from "@/lib/authz";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// PATCH /api/leads/[id] -> Status / Notizen / Wunschtermin / als gesehen markieren
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
  const access = await requireAccountAccess(lead.adAccountId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const b = (await req.json().catch(() => ({}))) as { status?: string; notes?: string; scheduledFor?: string | null; seen?: boolean };
  const data: Prisma.LeadUpdateInput = {};
  if (typeof b.status === "string" && b.status.trim()) {
    // Status muss eine bestehende Pipeline-Stufe des Kontos sein.
    const stage = await prisma.leadStage.findUnique({ where: { adAccountId_key: { adAccountId: lead.adAccountId, key: b.status } } });
    if (stage) {
      data.status = b.status;
      if (b.status !== "new" && !lead.lastContactedAt) data.lastContactedAt = new Date();
    }
  }
  if (typeof b.notes === "string") data.notes = b.notes;
  if (b.scheduledFor !== undefined) data.scheduledFor = b.scheduledFor ? new Date(b.scheduledFor) : null;
  if (b.seen && !lead.seenAt) data.seenAt = new Date();

  const updated = await prisma.lead.update({ where: { id }, data, include: { activities: { orderBy: { createdAt: "desc" } } } });
  return NextResponse.json(toLeadDTO(updated));
}
