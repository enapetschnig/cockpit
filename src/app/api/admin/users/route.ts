import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";
import { createCustomerUser, supabaseAdmin } from "@/lib/supabaseAdmin";
import { testConnection, syncCampaigns } from "@/lib/meta";
import { encryptToken, hasTokenKey } from "@/lib/adsCrypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/admin/users -> Kunden-Konten (mit zugewiesenem Login)
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const accounts = await prisma.adAccount.findMany({ where: { ownerUserId: { not: null } }, orderBy: { createdAt: "asc" } });
  let emails: Record<string, string> = {};
  try {
    const sb = await supabaseAdmin();
    const list = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    emails = Object.fromEntries(list.data.users.map((u) => [u.id, u.email ?? ""]));
  } catch {
    /* ignore */
  }
  return NextResponse.json({
    customers: accounts.map((a) => ({ accountLabel: a.label, metaAccountId: a.metaAccountId, ownerUserId: a.ownerUserId, email: a.ownerUserId ? emails[a.ownerUserId] || null : null })),
  });
}

// POST /api/admin/users { email, password, label, metaAccountId, token, pageId? }
// Legt einen Kunden-Login an und verbindet sein Werbekonto (ownerUserId gesetzt).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { email?: string; password?: string; label?: string; metaAccountId?: string; token?: string; pageId?: string };
  const email = (b.email ?? "").trim().toLowerCase();
  const password = (b.password ?? "").trim();
  const metaAccountId = (b.metaAccountId ?? "").trim();
  const token = (b.token ?? "").trim();
  if (!email || !password || password.length < 6) return NextResponse.json({ ok: false, error: "E-Mail + Passwort (min. 6 Zeichen) nötig" }, { status: 400 });
  if (!metaAccountId.startsWith("act_") || !token) return NextResponse.json({ ok: false, error: 'Werbekonto-ID (act_…) und Token nötig' }, { status: 400 });
  if (!(await hasTokenKey())) return NextResponse.json({ ok: false, error: "ADS_TOKEN_KEY fehlt – unter /connect setzen." }, { status: 400 });

  // Token testen
  let info;
  try {
    info = await testConnection(token, metaAccountId);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Token/Konto ungültig: " + (e instanceof Error ? e.message : String(e)) }, { status: 200 });
  }

  // Kunden-Login anlegen
  let ownerUserId: string;
  try {
    ownerUserId = await createCustomerUser(email, password);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }

  // Werbekonto verbinden + zuweisen
  const cipher = await encryptToken(token);
  const label = (b.label ?? "").trim() || info.name || metaAccountId;
  const acc = await prisma.adAccount.upsert({
    where: { metaAccountId },
    create: { label, metaAccountId, accountName: info.name ?? null, currency: info.currency ?? null, timezoneName: info.timezone ?? null, tokenCipher: cipher, pageId: b.pageId?.trim() || null, status: "connected", ownerUserId },
    update: { label, accountName: info.name ?? null, tokenCipher: cipher, status: "connected", lastError: null, ownerUserId },
  });
  await syncCampaigns(acc.id).catch(() => {});
  return NextResponse.json({ ok: true, email, accountLabel: acc.label });
}
