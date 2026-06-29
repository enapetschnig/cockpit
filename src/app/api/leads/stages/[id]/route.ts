import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAccountAccess } from "@/lib/authz";
import { toStageDTO } from "@/lib/leadStages";

export const dynamic = "force-dynamic";

// PATCH /api/leads/stages/[id] { label?, color?, order? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stage = await prisma.leadStage.findUnique({ where: { id } });
  if (!stage) return NextResponse.json({ ok: false, error: "Nicht gefunden" }, { status: 404 });
  const access = await requireAccountAccess(stage.adAccountId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const b = (await req.json().catch(() => ({}))) as { label?: string; color?: string; order?: number };
  const data: { label?: string; color?: string; order?: number } = {};
  if (typeof b.label === "string" && b.label.trim()) data.label = b.label.trim();
  if (typeof b.color === "string" && b.color.trim()) data.color = b.color.trim();
  if (typeof b.order === "number") data.order = b.order;
  const updated = await prisma.leadStage.update({ where: { id }, data });
  return NextResponse.json({ ok: true, stage: toStageDTO(updated) });
}

// DELETE /api/leads/stages/[id] -> Stufe löschen (Default-Stufen geschützt; Leads fallen auf "new" zurück)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stage = await prisma.leadStage.findUnique({ where: { id } });
  if (!stage) return NextResponse.json({ ok: false, error: "Nicht gefunden" }, { status: 404 });
  const access = await requireAccountAccess(stage.adAccountId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  if (stage.isDefault) return NextResponse.json({ ok: false, error: "Standard-Stufen können nicht gelöscht werden." }, { status: 400 });
  await prisma.lead.updateMany({ where: { adAccountId: stage.adAccountId, status: stage.key }, data: { status: "new" } });
  await prisma.leadStage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
