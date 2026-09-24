import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { sendTelegram, tgDownloadFile, tgAnswerCallback, tgEditMessage, tgTippt } from "@/lib/telegram";
import { transcribeVoice } from "@/lib/openai";
import { sendReply, sendNewEmail, type Account } from "@/lib/gmail";
import { createEvent } from "@/lib/calendar";
import { runAssistant, buildReplyDraft } from "@/lib/assistant";
import { listFollowups } from "@/lib/followups";
import { queueBeleg, approveAllCollected, retryBeleg, skipBeleg } from "@/lib/bmd/state";
import * as roboter from "@/lib/roboter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface TgMessage {
  text?: string;
  chat?: { id: number };
  voice?: { file_id: string };
  reply_to_message?: { message_id: number; text?: string };
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
  "• <b>/wuensche</b> – Änderungswünsche der Kunden & was der Roboter macht",
  "• <b>/yolo</b> – YOLO-Modus je Kunde: Wünsche ohne Freigabe sofort umsetzen & live",
  "• <b>/chat schafferhofer</b> – direkt mit dem Roboter eines Kunden reden (<b>/fertig</b> beendet)",
  "• Fass mir die Wünsche von Schafferhofer zusammen",
  "",
  "🤖 Vorschläge vom Roboter kommen hierher – freigeben, ändern oder einfach auf die Nachricht antworten und fragen.",
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
  const chatId = await getConfig("TELEGRAM_CHAT_ID");
  // Nicht ladbar (z. B. Datenbank kurz weg) → nichts durchlassen; Telegram stellt später erneut zu.
  if (!secret || !chatId) return NextResponse.json({ ok: false }, { status: 503 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: true });
  }

  const update = (await req.json().catch(() => ({}))) as { update_id?: number; message?: TgMessage; callback_query?: TgCallback };

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
    if (String(cb.message?.chat?.id) !== String(chatId)) {
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
  if (String(msg.chat?.id) !== String(chatId)) return NextResponse.json({ ok: true });

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
  if (text.startsWith("/wuensche") || text.startsWith("/wünsche") || text.startsWith("/roboter")) {
    const u = await roboter.uebersicht();
    await sendTelegram(u.text, u.buttons.length ? { buttons: u.buttons } : undefined);
    return;
  }
  if (text.startsWith("/yolo")) {
    const k = await roboter.yoloKarte();
    await sendTelegram(k.text, { buttons: k.buttons });
    return;
  }
  // Direkt mit dem Roboter eines Kunden reden: /chat schafferhofer … /fertig
  if (text.startsWith("/fertig") || text.startsWith("/ende")) {
    await roboter.gespraechBeenden();
    await sendTelegram("👋 Gespräch mit dem Roboter beendet – ab jetzt antworte wieder ich (Assistent).");
    return;
  }
  if (text.startsWith("/chat")) {
    const wer = text.replace(/^\/chat(@\w+)?/, "").trim();
    if (!wer) {
      const g = await roboter.gespraech();
      const name = g ? (await roboter.kundenNamen()).get(g.appKey) ?? g.appKey : null;
      await sendTelegram(g
        ? `💬 Du redest gerade mit dem Roboter von <b>${esc(name!)}</b>. /fertig beendet das Gespräch.`
        : "Mit wem? Zum Beispiel: <b>/chat schafferhofer</b>");
      return;
    }
    await gespraechOeffnen(wer);
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

  // Antwort auf eine Mail-Benachrichtigung? Die geht immer an den Assistenten (Entwurf) – auch wenn im
  // Mailtext zufällig „Projekt …“ oder „Auftrag …“ steht.
  const mail = msg.reply_to_message?.message_id
    ? await prisma.email.findFirst({ where: { telegramMsgId: String(msg.reply_to_message.message_id) } })
    : null;
  // Antwort auf eine Roboter-Nachricht? Die tragen unten „Auftrag xxxxxxxx“ bzw. „Projekt <app>“.
  const bezug = mail ? "" : msg.reply_to_message?.text || "";
  // die letzte Fundstelle – weiter oben könnte ein Wunschtext „Auftrag 12345678“ enthalten
  const ref = [...bezug.matchAll(/Auftrag ([0-9a-f]{8})\b/g)].pop()?.[1];
  const auftrag = ref ? await roboter.ladeAuftrag(ref) : null;
  // „Projekt …“ nur, wenn es wirklich eine angebundene App ist.
  const projektText = [...bezug.matchAll(/Projekt ([a-z0-9._-]+)/g)].pop()?.[1];
  const projekt = auftrag?.app_key ?? (projektText && (await roboter.kundenNamen()).has(projektText) ? projektText : null);
  if (auftrag && bezug.startsWith("✏️")) {
    const ok = await roboter.aendern(auftrag.id, instruction);
    await sendTelegram(ok
      ? "✏️ Alles klar – der Roboter überarbeitet den Vorschlag und meldet sich mit dem neuen Stand."
      : `Das geht gerade nicht mehr (Status: ${esc(auftrag.status)}). /wuensche zeigt den aktuellen Stand.`);
    return;
  }
  // Antworten auf Roboter-Nachrichten gehen direkt an den Roboter (Claude im Projekt-Verlauf) –
  // er antwortet selbst und kann den Vorschlag überarbeiten, den Freigabe-Knopf schicken oder einen Auftrag anlegen.
  if (projekt) {
    // Ohne Auftrag im Fuß (Start-Nachricht des Gesprächs, Antwort ohne Auftrag): den Auftrag des laufenden Gesprächs nehmen.
    const g0 = auftrag ? null : await roboter.gespraech(true);
    await roboterNachricht(projekt, auftrag?.id ?? (g0?.appKey === projekt ? g0.auftrag : null), instruction);
    return;
  }
  // Läuft ein Gespräch (/chat …), gehen auch freie Nachrichten an den Roboter – nicht Antworten auf Mails.
  const g = msg.reply_to_message ? null : await roboter.gespraech(true);
  if (g) {
    const laufend = g.auftrag ? await roboter.ladeAuftrag(g.auftrag) : null;
    await roboterNachricht(g.appKey, laufend && laufend.status !== "erledigt" ? laufend.id : null, instruction);
    return;
  }

  // Kontext: Antwort auf eine bestimmte Mail-Benachrichtigung?
  const replyEmailId: string | undefined = mail?.id;

  const result = await runAssistant(instruction, { replyEmailId, roboterAuftrag: auftrag?.id });

  if (result.roboterKarten?.length) {
    const intro = stripMd(result.reply || "").trim();
    if (intro) await sendTelegram(esc(intro));
    for (const k of result.roboterKarten) await sendTelegram(k.text, k.buttons.length ? { buttons: k.buttons } : undefined);
    return;
  }

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

/** Frage an den Roboter am PC – die Antwort kommt über /api/roboter/melden. */
/** Nachricht an den Roboter eines Kunden – er antwortet über /api/roboter/melden (meist nach 20–90 s). */
async function roboterNachricht(appKey: string, auftragId: string | null, text: string) {
  await roboter.frageStellen(appKey, auftragId, text);
  const p = await roboter.roboterPuls();
  if (p.laeuft) await tgTippt();
  else await sendTelegram("⚠️ Der Roboter am PC antwortet gerade nicht (PC aus?) – deine Nachricht wartet, er antwortet, sobald er wieder läuft.");
}

/** Gespräch mit dem Roboter eines Kunden öffnen (mit seinem laufenden Auftrag, falls es einen gibt). */
async function gespraechOeffnen(wer: string, auftragId?: string) {
  let appKey: string | undefined;
  let auftrag: string | null = auftragId ?? null;
  if (auftragId) appKey = (await roboter.ladeAuftrag(auftragId))?.app_key;
  else {
    const k = await roboter.findeKunde(wer);
    if (!k.appKey) {
      await sendTelegram(`Welchen Kunden meinst du? ${esc((k.kandidaten || []).slice(0, 12).join(", "))}`);
      return;
    }
    appKey = k.appKey;
    auftrag = (await roboter.auftragFuer({ kunde: k.name }))?.a?.id ?? null;
  }
  if (!appKey) return;
  await roboter.gespraechStarten(appKey, auftrag);
  const name = (await roboter.kundenNamen()).get(appKey) ?? appKey;
  await sendTelegram(
    `💬 Du redest jetzt direkt mit dem Roboter von <b>${esc(name)}</b> – er kennt den Code und den ganzen Verlauf.\n` +
      `Schreib einfach (Text oder 🎤): Fragen, Änderungen am Vorschlag, neue Aufträge. <b>/fertig</b> beendet das Gespräch.\n` +
      // Fuß mit dem Auftrag, wenn es einen gibt – eine Antwort auf diese Nachricht landet dann bei ihm.
      `<i>${auftrag ? `Auftrag ${roboter.kurz(auftrag)}` : `Projekt ${esc(appKey)}`}</i>`,
    { forceReply: "Nachricht an den Roboter" }
  );
}

async function roboterFrage(appKey: string, auftragId: string | null, frage: string) {
  await roboter.frageStellen(appKey, auftragId, frage);
  const p = await roboter.roboterPuls();
  await sendTelegram(p.laeuft
    ? "💬 Die Frage ist beim Roboter – er schaut im Code nach. Die Antwort kommt in 1–3 Minuten."
    : "💬 Frage notiert. Der Roboter am PC antwortet gerade nicht (PC aus?) – die Antwort kommt, sobald er wieder läuft.");
}

/** Knöpfe unter Roboter-Nachrichten: rob:<aktion>:<auftrag-id | app_key> */
async function roboterKnopf(cb: TgCallback) {
  const [, aktion, ref, zusatz] = (cb.data || "").split(":");
  const bearbeite = async (k: roboter.Karte) => {
    const ok = cb.message ? await tgEditMessage(cb.message.chat.id, cb.message.message_id, k.text, k.buttons) : false;
    // Zu lang oder nicht mehr änderbar → als neue Nachricht, sonst liefe der Knopf ins Leere
    if (!ok) await sendTelegram(k.text, k.buttons.length ? { buttons: k.buttons } : undefined);
  };

  if (aktion === "x") {
    await tgAnswerCallback(cb.id, "Abgebrochen");
    if (cb.message) await tgEditMessage(cb.message.chat.id, cb.message.message_id, "Abgebrochen – nichts geändert.");
    return;
  }

  if (aktion === "yolo") {
    // rob:yolo:<app_key>:<1|0>
    const an = zusatz === "1";
    const zurueck = await roboter.yoloSetzen(ref, an);
    await tgAnswerCallback(cb.id, an
      ? "⚡ YOLO an – Wünsche, die ab jetzt kommen, gehen ohne Freigabe live"
      : zurueck.length
        ? `YOLO aus – ${zurueck.length === 1 ? "1 Auftrag wartet" : `${zurueck.length} Aufträge warten`} wieder auf deine Freigabe`
        : "YOLO aus – wieder mit Freigabe");
    await bearbeite(await roboter.yoloKarte());
    for (const a of zurueck) {
      const k = await roboter.karteFuer(a, { kopf: "🟡 YOLO aus – wartet auf deine Freigabe" });
      await sendTelegram(k.text, { buttons: k.buttons });
    }
    return;
  }

  if (aktion === "start") {
    const r = await roboter.anRoboterGeben(ref);
    await tgAnswerCallback(cb.id, r.neu ? "✓ An den Roboter übergeben" : "Nichts Neues");
    const wuensche = r.neu === 1 ? "1 Wunsch" : `${r.neu} Wünsche`;
    await sendTelegram(!r.neu
      ? "Für diesen Kunden liegen keine offenen Wünsche mehr ohne Roboter-Auftrag."
      : r.yolo
        ? `⚡ ${wuensche} beim Roboter – YOLO: er setzt ${r.dazu ? "alles" : "sie"} <b>ohne Freigabe</b> um und schaltet live. Du bekommst Bescheid (⏹ Stopp auf der Karte).`
        : r.dazu
          ? `🤖 ${r.neu === 1 ? "1 Wunsch kommt" : `${r.neu} Wünsche kommen`} zum offenen Vorschlag dazu – der Roboter fasst alles neu zusammen.`
          : `🤖 ${r.neu === 1 ? "1 Wunsch ist" : `${r.neu} Wünsche sind`} beim Roboter – der gemeinsame Vorschlag kommt in ein paar Minuten.`);
    return;
  }

  const a = await roboter.ladeAuftrag(ref);
  if (!a) {
    await tgAnswerCallback(cb.id, "Nicht mehr verfügbar");
    return;
  }
  const kunde = (await roboter.kundenNamen()).get(a.app_key) ?? a.app_key;
  // Nach einer Änderung die Karte neu laden – zeigt dann den neuen Stand statt der alten Knöpfe.
  const danach = async (hinweis: string, ok: boolean) => {
    await tgAnswerCallback(cb.id, ok ? hinweis : "Geht nicht mehr – der Stand hat sich geändert");
    const jetzt = await roboter.ladeAuftrag(a.id);
    if (jetzt) await bearbeite(await roboter.karteFuer(jetzt));
  };

  switch (aktion) {
    case "zeig": {
      await tgAnswerCallback(cb.id);
      const k = await roboter.karteFuer(a);
      await sendTelegram(k.text, { buttons: k.buttons });
      return;
    }
    case "zur":
      await tgAnswerCallback(cb.id);
      await bearbeite(await roboter.karteFuer(a));
      return;
    case "frei": // erst nachfragen – Freigeben schaltet live
      if (!["vorschlag", "db_freigabe", "vorschau"].includes(a.status)) return danach("", false);
      await tgAnswerCallback(cb.id);
      await bearbeite(await roboter.karteFuer(a, { bestaetigen: true }));
      return;
    case "dbp": // Altaufträge (2.1): auch hier erst nachfragen – schaltet live
      if (!roboter.handarbeit(a)) return danach("", false);
      await tgAnswerCallback(cb.id);
      await bearbeite(await roboter.karteFuer(a, { bestaetigen: true }));
      return;
    case "ja": {
      // rob:ja:<id>:<stand> – gilt nur für den Stand, der auf der Bestätigungs-Karte zu sehen war
      if (!zusatz || zusatz !== a.ver) {
        await tgAnswerCallback(cb.id, "Der Stand hat sich geändert – bitte nochmal ansehen");
        await bearbeite(await roboter.karteFuer(a));
        return;
      }
      const ok = a.status === "vorschlag" ? await roboter.freigeben(a.id, zusatz)
        : a.status === "db_freigabe" ? await roboter.datenbankFreigeben(a.id, zusatz)
          : a.status === "vorschau" ? await roboter.liveSchalten(a.id, zusatz)
            : roboter.handarbeit(a) ? await roboter.datenbankEinspielen(a.id, zusatz) : false;
      return danach(a.status === "vorschlag" ? "✅ Freigegeben – der Roboter legt los"
        : a.status === "wartet" ? "🗄 Der Roboter prüft, spielt die Datenbank ein und schaltet live"
          : "🚀 Wird eingespielt und live geschaltet", ok);
    }
    case "stop":
      return danach("⏹ Gestoppt – es geht nichts live", a.yolo && (await roboter.stoppen(a.id)));
    case "aend":
      await tgAnswerCallback(cb.id);
      await sendTelegram(`✏️ Was soll beim Vorschlag für <b>${esc(kunde)}</b> anders sein? Antworte auf diese Nachricht (Text oder 🎤).\n<i>Auftrag ${roboter.kurz(a.id)}</i>`, { forceReply: "Was soll anders sein?" });
      return;
    case "chat":
    case "frage": // alte Karten
      await tgAnswerCallback(cb.id, "💬 Gespräch mit dem Roboter");
      await gespraechOeffnen(kunde, a.id);
      return;
    case "abl":
      return danach("❌ Abgelehnt – am Code ändert sich nichts", await roboter.ablehnen(a.id));
    case "verw":
      return danach("🗑 Verworfen", await roboter.verwerfen(a.id));
    case "nochmal":
      return danach("🔁 Der Roboter versucht es erneut", await roboter.nochmal(a));
    case "vsc": // „In VS Code erledigt“ aus 2.1 gibt es nicht mehr
    default:
      await tgAnswerCallback(cb.id, "Knopf veraltet – bitte /wuensche");
      await bearbeite(await roboter.karteFuer(a));
  }
}

async function handleCallback(cb: TgCallback) {
  if (cb.data?.startsWith("rob:")) return roboterKnopf(cb);
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
