import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { testConnection, syncCampaigns } from "@/lib/meta";
import { encryptToken, hasTokenKey } from "@/lib/adsCrypto";
import { toAdAccountDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ads/account { label, metaAccountId, token, pageId? }
// Testet Token + Konto, speichert verschlüsselt, synct sofort. Auch zum Neu-Verbinden.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { label?: string; metaAccountId?: string; token?: string; pageId?: string };
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
    },
  });
  await syncCampaigns(acc.id).catch(() => {});
  return NextResponse.json({ ok: true, account: toAdAccountDTO(acc) });
}
