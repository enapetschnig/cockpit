import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConfig, clearConfigCache } from "@/lib/config";
import { tgSetWebhook } from "@/lib/telegram";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Registriert den Telegram-Webhook auf die aktuelle Domain
 * (lokal sinnlos – Telegram erreicht localhost nicht; auf Vercel nach dem Deploy aufrufen).
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
    return NextResponse.json(
      { error: "Telegram erreicht localhost nicht – bitte auf der Vercel-URL ausführen." },
      { status: 400 }
    );
  }
  const url = `${origin}/api/telegram/webhook`;

  let secret = await getConfig("TELEGRAM_WEBHOOK_SECRET");
  if (!secret) {
    secret = crypto.randomBytes(16).toString("hex");
    await prisma.setting.upsert({
      where: { key: "TELEGRAM_WEBHOOK_SECRET" },
      create: { key: "TELEGRAM_WEBHOOK_SECRET", value: secret },
      update: { value: secret },
    });
    clearConfigCache();
  }

  const res = await tgSetWebhook(url, secret);
  if (!res.ok) return NextResponse.json({ error: res.description || "setWebhook fehlgeschlagen", url }, { status: 502 });
  return NextResponse.json({ ok: true, url });
}
