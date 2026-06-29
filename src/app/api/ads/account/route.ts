import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { testConnection, syncCampaigns } from "@/lib/meta";
import { encryptToken, hasTokenKey } from "@/lib/adsCrypto";
import { toAdAccountDTO } from "@/lib/serialize";
import { getSessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/account { label, metaAccountId, token, pageId?, ownerUserId? }
// Testet Token + Konto, speichert verschlüsselt, synct sofort. Nur Admin (kann Konto einem Kunden zuweisen).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ ok: false, error: "Nur der Admin kann Werbekonten verbinden." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { label?: string; metaAccountId?: string; token?: string; pageId?: string; ownerUserId?: string };
  const metaAccountId = (b.metaAccountId ?? "").trim();
  const token = (b.token ?? "").trim();
  const label = (b.label ?? "").trim() || metaAccountId;
  if (!metaAccountId || !token) return NextResponse.json({ ok: false, error: "metaAccountId und token nötig" }, { status: 400 });
  if (!metaAccountId.startsWith("act_")) return NextResponse.json({ ok: false, error: 'Konto-ID muss mit "act_" beginnen' }, { status: 400 });
  if (!(await hasTokenKey())) return NextResponse.json({ ok: false, error: "ADS_TOKEN_KEY fehlt – unter /connect setzen." }, { status: 400 });

  let info;
  try {
    info = await testConnection(token, metaAccountId);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }

  const cipher = await encryptToken(token);
  const acc = await prisma.adAccount.upsert({
    where: { metaAccountId },
    create: {
      label,
      metaAccountId,
      accountName: info.name ?? null,
      currency: info.currency ?? null,
      timezoneName: info.timezone ?? null,
      tokenCipher: cipher,
      pageId: b.pageId?.trim() || null,
      status: "connected",
      ownerUserId: b.ownerUserId?.trim() || null,
    },
    update: {
      label,
      accountName: info.name ?? null,
      currency: info.currency ?? null,
      timezoneName: info.timezone ?? null,
      tokenCipher: cipher,
      pageId: b.pageId?.trim() || null,
      status: "connected",
      lastError: null,
      ownerUserId: b.ownerUserId !== undefined ? b.ownerUserId?.trim() || null : undefined,
    },
  });
  await syncCampaigns(acc.id).catch(() => {});
  return NextResponse.json({ ok: true, account: toAdAccountDTO(acc) });
}

// PATCH /api/ads/account { accountId, privacyPolicyUrl } -> Datenschutz-Link je Konto setzen (Admin)
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ ok: false, error: "Nur der Admin." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { accountId?: string; privacyPolicyUrl?: string };
  const accountId = (b.accountId ?? "").trim();
  if (!accountId) return NextResponse.json({ ok: false, error: "accountId nötig" }, { status: 400 });
  const url = (b.privacyPolicyUrl ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) return NextResponse.json({ ok: false, error: "Bitte eine gültige URL (https://…) angeben." }, { status: 400 });
  const acc = await prisma.adAccount.update({ where: { id: accountId }, data: { privacyPolicyUrl: url || null } });
  return NextResponse.json({ ok: true, account: toAdAccountDTO(acc) });
}
