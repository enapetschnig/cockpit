import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAccountAccess } from "@/lib/authz";
import { ensureStages, toStageDTO } from "@/lib/leadStages";

export const dynamic = "force-dynamic";

// GET /api/leads/stages?accountId= -> Pipeline-Stufen (seedet Defaults), scoped
export async function GET(req: Request) {
  const u = new URL(req.url);
  const accountId = u.searchParams.get("accountId") || "";
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ error: access.error, stages: [] }, { status: access.status });
  const stages = await ensureStages(accountId);
  return NextResponse.json({ stages });
}

// POST /api/leads/stages { accountId, label, color } -> neue Pipeline-Stufe
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { accountId?: string; label?: string; color?: string };
  const accountId = (b.accountId ?? "").trim();
  const access = await requireAccountAccess(accountId);
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const label = (b.label ?? "").trim();
  const color = (b.color ?? "").trim() || "#6b7280";
  if (!label) return NextResponse.json({ ok: false, error: "Name nötig" }, { status: 400 });
  await ensureStages(accountId);
  const max = await prisma.leadStage.aggregate({ where: { adAccountId: accountId }, _max: { order: true } });
  const key = "s_" + Math.random().toString(36).slice(2, 10);
  const stage = await prisma.leadStage.create({
    data: { adAccountId: accountId, key, label, color, order: (max._max.order ?? 0) + 1, isDefault: false },
  });
  return NextResponse.json({ ok: true, stage: toStageDTO(stage) });
}
