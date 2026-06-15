import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { sendTelegram, tgDownloadFile, tgAnswerCallback, tgEditMessage } from "@/lib/telegram";
import { transcribeVoice, draftEmailReply } from "@/lib/openai";
import { sendReply, type Account } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface TgMessage {
  text?: string;
  chat?: { id: number };
  voice?: { file_id: string };
  reply_to_message?: { message_id: number };
}

interface TgCallback {
  id: string;
  data?: string;
  message?: { chat: { id: number }; message_id: number };
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: Request) {
  // Absicherung: Telegram sendet den bei setWebhook hinterlegten Secret-Token mit.
  const secret = await getConfig("TELEGRAM_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: true });
  }

  const update = (await req.json().catch(() => ({}))) as { message?: TgMessage; callback_query?: TgCallback };
  const chatId = await getConfig("TELEGRAM_CHAT_ID");

  // Button-Klick (Senden / Verwerfen)
  if (update.callback_query) {
    const cb = update.callback_query;
    if (chatId && String(cb.message?.chat?.id) !== String(chatId)) {
      await tgAnswerCallback(cb.id);
      return NextResponse.json({ ok: true });
    }
    try {
      await handleCallback(cb);
    } catch (e) {
      console.error("[telegram/webhook] callback", e);
      await tgAnswerCallback(cb.id, "Fehler");
      await sendTelegram("⚠️ Fehler beim Senden: " + esc((e as Error).message));
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update.message;
  if (!msg) return NextResponse.json({ ok: true });
  // Nur der eigene Chat darf den Bot bedienen
  if (chatId && String(msg.chat?.id) !== String(chatId)) return NextResponse.json({ ok: true });

  try {
    await handleMessage(msg);
  } catch (e) {
    console.error("[telegram/webhook]", e);
    await sendTelegram("⚠️ Fehler: " + esc((e as Error).message));
  }
  return NextResponse.json({ ok: true });
}

async function handleMessage(msg: TgMessage) {
  const text = msg.text ?? "";

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendTelegram(
      "👋 <b>ePower Cockpit Bot</b>\nAntworte auf eine Mail-Benachrichtigung – per Text oder 🎤 Sprachnachricht – " +
        "ich formuliere eine Antwort, die du dann per Klick (✅ Senden) sendest.\n\n/offen – offene firmenrelevante Mails"
    );
    return;
  }

  if (text.startsWith("/offen")) {
    const open = await prisma.email.findMany({
      where: { firmenrelevant: true, outgoing: false, customerId: null, filed: false },
      orderBy: { receivedAt: "desc" },
      take: 10,
    });
    await sendTelegram(
      open.length
        ? "<b>Offen:</b>\n" + open.map((e) => `• ${esc(e.fromName)}: ${esc(e.subject)}`).join("\n")
        : "✅ Keine offenen firmenrelevanten Mails."
    );
    return;
  }

  // Anweisung aus Text oder Sprachnachricht
  let instruction = text.trim();
  if (msg.voice?.file_id) {
    const audio = await tgDownloadFile(msg.voice.file_id);
    if (!audio) {
      await sendTelegram("⚠️ Sprachnachricht konnte nicht geladen werden.");
      return;
    }
    instruction = await transcribeVoice(audio);
    await sendTelegram("🎤 <b>Verstanden:</b>\n" + esc(instruction));
  }
  if (!instruction) return;

  // Ziel-Mail: bevorzugt die Mail, auf deren Push geantwortet wurde
  let target = msg.reply_to_message?.message_id
    ? await prisma.email.findFirst({ where: { telegramMsgId: String(msg.reply_to_message.message_id) } })
    : null;
  if (!target) {
    target = await prisma.email.findFirst({
      where: { firmenrelevant: true, outgoing: false },
      orderBy: { receivedAt: "desc" },
    });
  }
  if (!target) {
    await sendTelegram("Ich finde keine Mail zum Antworten. Antworte am besten direkt auf eine Mail-Benachrichtigung.");
    return;
  }

  const draftText = await draftEmailReply({
    fromName: target.fromName,
    fromAddr: target.fromAddr,
    subject: target.subject,
    body: target.body,
    instruction,
  });

  if (!target.gmailId) {
    await sendTelegram("✍️ <b>Antwort:</b>\n" + esc(draftText) + "\n\n(Diese Mail stammt nicht aus Gmail – Senden nicht möglich.)");
    return;
  }

  // Antwort zwischenspeichern und zur Kontrolle mit Senden/Verwerfen anzeigen
  await prisma.email.update({ where: { id: target.id }, data: { pendingReply: draftText } });
  await sendTelegram(`✍️ <b>Antwort an ${esc(target.fromName)}</b>\n\n${esc(draftText)}\n\n<i>Bitte kontrollieren:</i>`, {
    buttons: [[
      { text: "✅ Senden", data: `send:${target.id}` },
      { text: "🗑 Verwerfen", data: `del:${target.id}` },
    ]],
  });
}

async function handleCallback(cb: TgCallback) {
  const [action, emailId] = (cb.data || "").split(":");
  const email = emailId ? await prisma.email.findUnique({ where: { id: emailId } }) : null;
  if (!email) {
    await tgAnswerCallback(cb.id, "Nicht mehr verfügbar");
    return;
  }

  if (action === "del") {
    await prisma.email.update({ where: { id: email.id }, data: { pendingReply: null } });
    await tgAnswerCallback(cb.id, "Verworfen");
    if (cb.message) await tgEditMessage(cb.message.chat.id, cb.message.message_id, "🗑 Antwort verworfen.");
    return;
  }

  if (action === "send") {
    if (!email.pendingReply || !email.gmailId) {
      await tgAnswerCallback(cb.id, "Nichts zu senden");
      return;
    }
    const text = email.pendingReply;
    const res = await sendReply(email.account as Account, email.gmailId, text);
    await prisma.email.update({ where: { id: email.id }, data: { pendingReply: null } });
    await tgAnswerCallback(cb.id, "Gesendet ✅");
    if (cb.message) {
      await tgEditMessage(cb.message.chat.id, cb.message.message_id, `✅ <b>Gesendet an ${esc(res.to)}</b>\n<i>${esc(res.subject)}</i>\n\n${esc(text)}`);
    }
    return;
  }

  await tgAnswerCallback(cb.id);
}
