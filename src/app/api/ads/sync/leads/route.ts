import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncLeads } from "@/lib/meta";
import { getSessionUser, accountScope, requireAccountAccess } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runSync(accountIds: string[]) {
  const results: { id: string; created?: number; total?: number; note?: string; error?: string }[] = [];
  for (const id of accountIds) {
    try {
      const r = await syncLeads(id);
      results.push({ id, created: r.created, total: r.total, note: r.note });
    } catch (e) {
      results.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// GET (Cron, per CRON_SECRET) -> synct ALLE verbundenen Konten
export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET;
  const u = new URL(req.url);
  const ok = cron && (req.headers.get("authorization") === `Bearer ${cron}` || u.searchParams.get("key") === cron);
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const accs = await prisma.adAccount.findMany({ where: { tokenCipher: { not: null } }, select: { id: true } });
  const results = await runSync(accs.map((a) => a.id));
  return NextResponse.json({ ok: true, results });
}

// POST /api/ads/sync/leads { accountId? } -> persistiert neue Leads (eigene Konten)
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { accountId?: string };
  let accountIds: string[];
  if (body.accountId) {
    const access = await requireAccountAccess(body.accountId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    accountIds = [access.account.id];
  } else {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
    const accs = await prisma.adAccount.findMany({ where: { ...accountScope(user), tokenCipher: { not: null } }, select: { id: true } });
    accountIds = accs.map((a) => a.id);
  }
  const results = await runSync(accountIds);
  return NextResponse.json({ ok: true, results });
}
