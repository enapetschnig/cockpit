import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { sendTelegram, tgDownloadFile, tgAnswerCallback, tgEditMessage } from "@/lib/telegram";
import { transcribeVoice } from "@/lib/openai";
import { sendReply, sendNewEmail, type Account } from "@/lib/gmail";
import { createEvent } from "@/lib/calendar";
import { runAssistant } from "@/lib/assistant";

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

// Markdown entfernen (Telegram zeigt **/# sonst wörtlich an)
function stripMd(s: string): string {
  return (s || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

const HELP = [
  "👋 <b>ePower Cockpit Bot</b>",
  "Frag mich einfach etwas zu deinen Mails – z. B.:",
  "• Welche Mails habe ich heute bekommen?",
  "• Gibt es offene Rechnungen?",
  "• Was ist von Pachlinger offen?",
  "",
  "Antworte direkt auf eine Mail-Benachrichtigung (Text oder 🎤 Sprache) – ich formuliere die Antwort, du sendest per Klick.",
].join("\n");

export async function POST(req: Request) {
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
    await sendTelegram(HELP);
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
    await sendTelegram("🎤 <i>" + esc(instruction) + "</i>");
  }
  if (!instruction) return;

  // Kontext: Antwort auf eine bestimmte Mail-Benachrichtigung?
  let replyEmailId: string | undefined;
  if (msg.reply_to_message?.message_id) {
    const e = await prisma.email.findFirst({ where: { telegramMsgId: String(msg.reply_to_message.message_id) } });
    if (e) replyEmailId = e.id;
  }

  const result = await runAssistant(instruction, { replyEmailId });

  if (result.draftedFor) {
    const d = result.draftedFor;
    await prisma.email.update({ where: { id: d.emailId }, data: { pendingReply: d.text } });
    const accLabel = d.account === "firma" ? "Firma" : d.account === "privat" ? "Privat" : d.account;
    await sendTelegram(
      `✍️ <b>Antwort vorbereitet</b>\n` +
        `📤 Von: ${esc(d.fromEmail)} (${accLabel})\n` +
        `📥 An: ${esc(d.fromName)} &lt;${esc(d.toAddr)}&gt;\n` +
        `📝 ${esc(d.subject)}\n\n` +
        `${esc(d.text)}\n\n<i>Bitte kontrollieren:</i>`,
      {
        buttons: [[
          { text: "✅ Senden", data: `send:${d.emailId}` },
          { text: "🗑 Verwerfen", data: `del:${d.emailId}` },
        ]],
      }
    );
  } else if (result.newEmail) {
    const n = result.newEmail;
    const accLabel = n.account === "firma" ? "Firma" : "Privat";
    await sendTelegram(
      `✉️ <b>Neue Mail vorbereitet</b>\n` +
        `📤 Von: ${esc(n.fromEmail)} (${accLabel})\n` +
        `📥 An: ${n.toName ? esc(n.toName) + " " : ""}&lt;${esc(n.toAddr)}&gt;\n` +
        `📝 ${esc(n.subject)}\n\n` +
        `${esc(n.body)}\n\n<i>Bitte kontrollieren:</i>`,
      {
        buttons: [[
          { text: "✅ Senden", data: `sendnew:${n.pendingId}` },
          { text: "🗑 Verwerfen", data: `delnew:${n.pendingId}` },
        ]],
      }
    );
  } else {
    await sendTelegram(esc(stripMd(result.reply)) || "…");
  }
}

async function handleCallback(cb: TgCallback) {
  const [action, id] = (cb.data || "").split(":");

  // Komplett neue Mail (PendingEmail)
  if (action === "sendnew" || action === "delnew") {
    const p = id ? await prisma.pendingEmail.findUnique({ where: { id } }) : null;
    if (!p) {
      await tgAnswerCallback(cb.id, "Nicht mehr verfügbar");
      return;
    }
    if (action === "delnew") {
      await prisma.pendingEmail.delete({ where: { id: p.id } });
      await tgAnswerCallback(cb.id, "Verworfen");
      if (cb.message) await tgEditMessage(cb.message.chat.id, cb.message.message_id, "🗑 Mail verworfen.");
      return;
    }
    await sendNewEmail(p.account as Account, p.toAddr, p.subject, p.body);
    await prisma.pendingEmail.delete({ where: { id: p.id } });
    await tgAnswerCallback(cb.id, "Gesendet ✅");
    if (cb.message) await tgEditMessage(cb.message.chat.id, cb.message.message_id, `✅ <b>Gesendet an ${esc(p.toAddr)}</b>\n<i>${esc(p.subject)}</i>\n\n${esc(p.body)}`);
    return;
  }

  const email = id ? await prisma.email.findUnique({ where: { id } }) : null;
  if (!email) {
    await tgAnswerCallback(cb.id, "Nicht mehr verfügbar");
    return;
  }

  // Ein-Tipp-Aktionen aus dem Mail-Push (Buttons bleiben erhalten)
  if (action === "file") {
    await prisma.email.update({ where: { id: email.id }, data: { filed: true } });
    await tgAnswerCallback(cb.id, "✓ In Buchhaltung abgelegt");
    return;
  }
  if (action === "todo") {
    let todos: string[] = [];
    try {
      todos = JSON.parse(email.suggestedTodosJson || "[]");
    } catch {
      todos = [];
    }
    const text = todos[0] || `Follow-up: ${email.subject}`;
    await prisma.todo.create({ data: { text, emailId: email.id, customerId: email.customerId } });
    await tgAnswerCallback(cb.id, "✓ Aufgabe angelegt");
    return;
  }
  if (action === "cev") {
    if (!email.proposedEventJson) {
      await tgAnswerCallback(cb.id, "Kein Terminvorschlag");
      return;
    }
    const pe = JSON.parse(email.proposedEventJson) as { title: string; start: string; end: string };
    const ev = await createEvent(email.account === "privat" ? "privat" : "firma", {
      title: pe.title,
      start: pe.start,
      end: pe.end,
      description: `Aus Mail von ${email.fromName} <${email.fromAddr}>`,
    });
    await tgAnswerCallback(cb.id, "✓ Termin eingetragen");
    await sendTelegram(`📅 <b>Termin eingetragen</b> (${email.account})\n${esc(ev.summary)} — ${ev.start.slice(0, 16).replace("T", " ")}`);
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
    const textToSend = email.pendingReply;
    const res = await sendReply(email.account as Account, email.gmailId, textToSend);
    await prisma.email.update({ where: { id: email.id }, data: { pendingReply: null } });
    await tgAnswerCallback(cb.id, "Gesendet ✅");
    if (cb.message) {
      await tgEditMessage(
        cb.message.chat.id,
        cb.message.message_id,
        `✅ <b>Gesendet an ${esc(res.to)}</b>\n<i>${esc(res.subject)}</i>\n\n${esc(textToSend)}`
      );
    }
    return;
  }

  await tgAnswerCallback(cb.id);
}
