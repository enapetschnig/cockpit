import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncCampaigns } from "@/lib/meta";
import { getSessionUser, accountScope, requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/sync { accountId? } -> synchronisiert ein oder alle EIGENEN verbundenen Konten
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { accountId?: string };
  let accounts;
  if (body.accountId) {
    const access = await requireAccountAccess(body.accountId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    accounts = [access.account];
  } else {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
    accounts = await prisma.adAccount.findMany({ where: { ...accountScope(user), tokenCipher: { not: null } } });
  }

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
