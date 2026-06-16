import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncCampaigns } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/sync { accountId? } -> synchronisiert ein oder alle verbundenen Konten
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { accountId?: string };
  const accounts = body.accountId
    ? await prisma.adAccount.findMany({ where: { id: body.accountId } })
    : await prisma.adAccount.findMany({ where: { tokenCipher: { not: null } } });

  const results: { id: string; ok: boolean; count?: number; error?: string }[] = [];
  for (const a of accounts) {
    try {
      const r = await syncCampaigns(a.id);
      results.push({ id: a.id, ok: true, count: r.count });
    } catch (e) {
      results.push({ id: a.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
