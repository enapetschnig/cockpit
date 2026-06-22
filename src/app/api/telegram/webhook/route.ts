import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { sendTelegram, tgDownloadFile, tgAnswerCallback, tgEditMessage } from "@/lib/telegram";
import { transcribeVoice } from "@/lib/openai";
import { sendReply, sendNewEmail, type Account } from "@/lib/gmail";
import { createEvent } from "@/lib/calendar";
import { runAssistant, buildReplyDraft } from "@/lib/assistant";
import { listFollowups } from "@/lib/followups";
import { queueBeleg, approveAllCollected, retryBeleg, skipBeleg } from "@/lib/bmd/state";

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
  "Frag mich einfach etwas – z. B.:",
  "• Welche Mails habe ich heute bekommen?",
  "• <b>/offen</b> – offene Aufgaben & Follow-ups zum Abhaken",
  "• Trag mir Donnerstag 14 Uhr einen Termin mit Müller ein",
  "• Was ist von Pachlinger offen?",
  "",
  "📅 Termine trage ich direkt in den Google-Kalender ein.",
  "Antworte direkt auf eine Mail-Benachrichtigung (Text oder 🎤 Sprache) – ich formuliere die Antwort, du sendest per Klick.",
].join("\n");

function short(s: string, n = 26): string {
  const t = (s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** Baut die abhakbare Offen-Übersicht (Aufgaben + wartende Follow-ups) mit Knöpfen. */
async function buildOpenOverview(): Promise<{ text: string; buttons: { text: string; data: string }[][] }> {
  const [todos, fups] = await Promise.all([
    prisma.todo.findMany({ where: { done: false }, include: { customer: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    listFollowups(48, 8),
  ]);
  const lines: string[] = ["🗂 <b>Offene Punkte</b>"];
  const buttons: { text: string; data: string }[][] = [];

  if (todos.length) {
    lines.push("", "<b>Aufgaben</b> – tippe ✅ zum Abhaken");
    for (const t of todos) {
      lines.push(`• ${esc(t.text)}${t.customer ? " — " + esc(t.customer.name) : ""}`);
      buttons.push([{ text: "✅ " + short(t.text), data: "tdone:" + t.id }]);
    }
  }
  if (fups.length) {
    lines.push("", "<b>Wartet auf Antwort</b>");
    for (const f of fups) {
      lines.push(`• ${esc(f.fromName)}: ${esc(f.subject)}`);
      buttons.push([
        { text: "✍️ " + short(f.fromName, 16), data: "frep:" + f.id },
        { text: "✓ erledigt", data: "fdone:" + f.id },
      ]);
    }
  }
  if (!todos.length && !fups.length) lines.push("", "🎉 Nichts offen – alles erledigt!");
  return { text: lines.join("\n"), buttons };
}

async function sendOpenOverview(): Promise<void> {
  const { text, buttons } = await buildOpenOverview();
  await sendTelegram(text, buttons.length ? { buttons } : undefined);
}

/** Aktualisiert die bestehende Offen-Liste nach dem Abhaken (Knöpfe neu aufbauen). */
async function refreshOverview(cb: TgCallback): Promise<void> {
  if (!cb.message) return;
  const { text, buttons } = await buildOpenOverview();
  await tgEditMessage(cb.message.chat.id, cb.message.message_id, text, buttons.length ? buttons : undefined);
}

export async function POST(req: Request) {
  const secret = await getConfig("TELEGRAM_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: true });
  }

  const update = (await req.json().catch(() => ({}))) as { update_id?: number; message?: TgMessage; callback_query?: TgCallback };
  const chatId = await getConfig("TELEGRAM_CHAT_ID");

  // Dedupe: Telegram stellt Updates bei Timeout erneut zu -> jedes nur einmal verarbeiten
  if (typeof update.update_id === "number") {
    const lr = await prisma.setting.findUnique({ where: { key: "LAST_TG_UPDATE" } });
    const last = lr?.value ? Number(lr.value) : 0;
    if (update.update_id <= last) return NextResponse.json({ ok: true });
    await prisma.setting.upsert({ where: { key: "LAST_TG_UPDATE" }, create: { key: "LAST_TG_UPDATE", value: String(update.update_id) }, update: { value: String(update.update_id) } });
  }

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
  if (text.startsWith("/offen") || text.startsWith("/aufgaben") || text.startsWith("/todos")) {
    await sendOpenOverview();
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

  if (result.openOverview) {
    const intro = stripMd(result.reply || "").trim();
    if (intro && intro.length < 200) await sendTelegram(esc(intro));
    await sendOpenOverview();
    return;
  }

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

  // Buchhaltung / BMD: Beleg freigeben / erneut / ignorieren (id = "all" oder belegId, KEINE Email).
  if (action === "bmd" || action === "bmdr" || action === "bmdx") {
    if (action === "bmd" && id === "all") {
      const n = await approveAllCollected("telegram");
      await tgAnswerCallback(cb.id, `✓ ${n} freigegeben`);
      if (cb.message) await tgEditMessage(cb.message.chat.id, cb.message.message_id, `📤 <b>${n} Beleg(e) an BMD freigegeben.</b>`);
      return;
    }
    const beleg = id ? await prisma.beleg.findUnique({ where: { id } }) : null;
    if (!beleg) {
      await tgAnswerCallback(cb.id, "Nicht mehr verfügbar");
      return;
    }
    if (action === "bmd") {
      await queueBeleg(beleg.id, "telegram");
      await tgAnswerCallback(cb.id, "✓ An BMD freigegeben");
      if (cb.message) await tgEditMessage(cb.message.chat.id, cb.message.message_id, `📤 <b>${esc(beleg.vendor)} an BMD freigegeben</b> – wird hochgeladen.`);
    } else if (action === "bmdr") {
      await retryBeleg(beleg.id);
      await tgAnswerCallback(cb.id, "✓ Erneut eingereiht");
    } else {
      await skipBeleg(beleg.id);
      await tgAnswerCallback(cb.id, "✓ Ignoriert");
      if (cb.message) await tgEditMessage(cb.message.chat.id, cb.message.message_id, `🚫 <b>${esc(beleg.vendor)} ignoriert.</b>`);
    }
    return;
  }

  // Offen-Liste: Aufgabe abhaken / Follow-up erledigt / Follow-up beantworten
  if (action === "tdone") {
    const t = id ? await prisma.todo.findUnique({ where: { id } }) : null;
    if (t && !t.done) await prisma.todo.update({ where: { id: t.id }, data: { done: true } });
    await tgAnswerCallback(cb.id, t ? "✓ erledigt: " + short(t.text, 30) : "Schon weg");
    await refreshOverview(cb);
    return;
  }
  if (action === "fdone") {
    const e = id ? await prisma.email.findUnique({ where: { id } }) : null;
    if (e) await prisma.email.update({ where: { id: e.id }, data: { repliedAt: new Date() } });
    await tgAnswerCallback(cb.id, "✓ Als erledigt markiert");
    await refreshOverview(cb);
    return;
  }
  if (action === "frep") {
    const e = id ? await prisma.email.findUnique({ where: { id } }) : null;
    if (!e) {
      await tgAnswerCallback(cb.id, "Nicht mehr verfügbar");
      return;
    }
    await tgAnswerCallback(cb.id, "✍️ Entwurf wird erstellt …");
    const d = await buildReplyDraft(e.id, "Antworte freundlich, knapp und passend auf diese Mail.");
    if (!d) {
      await sendTelegram("⚠️ Konnte keinen Entwurf erstellen.");
      return;
    }
    await prisma.email.update({ where: { id: d.emailId }, data: { pendingReply: d.text } });
    const accLabel = d.account === "firma" ? "Firma" : "Privat";
    await sendTelegram(
      `✍️ <b>Antwort vorbereitet</b>\n📤 Von: ${esc(d.fromEmail)} (${accLabel})\n📥 An: ${esc(d.fromName)} &lt;${esc(d.toAddr)}&gt;\n📝 ${esc(d.subject)}\n\n${esc(d.text)}\n\n<i>Bitte kontrollieren:</i>`,
      { buttons: [[{ text: "✅ Senden", data: `send:${d.emailId}` }, { text: "🗑 Verwerfen", data: `del:${d.emailId}` }]] }
    );
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
