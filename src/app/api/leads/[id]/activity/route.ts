import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toLeadDTO } from "@/lib/serialize";
import { requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";

const CHANNELS = ["call", "whatsapp", "email", "visit", "note"];

// POST /api/leads/[id]/activity { channel, note, outcome? } -> Kontakt-Log-Eintrag
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead nicht gefunden" }, { status: 404 });
  const access = await requireAccountAccess(lead.adAccountId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const b = (await req.json().catch(() => ({}))) as { channel?: string; note?: string; outcome?: string };
  const channel = CHANNELS.includes(b.channel || "") ? (b.channel as string) : "note";
  const note = (b.note || "").trim();
  if (!note) return NextResponse.json({ error: "Notiz nötig" }, { status: 400 });

  await prisma.leadActivity.create({ data: { leadId: id, channel, note, outcome: b.outcome?.trim() || null } });
  // Lead als kontaktiert markieren (status nur anheben, nicht zurückstufen)
  const data: { lastContactedAt: Date; status?: string } = { lastContactedAt: new Date() };
  if (lead.status === "new" && channel !== "note") data.status = channel === "visit" ? "scheduled" : "contacted";
  const updated = await prisma.lead.update({ where: { id }, data, include: { activities: { orderBy: { createdAt: "desc" } } } });
  return NextResponse.json(toLeadDTO(updated));
}
