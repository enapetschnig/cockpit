/**
 * Telegram – Senden, Datei-Download (Sprachnachrichten), Webhook-Setup.
 * Token/Chat-ID kommen aus der Config (Supabase/Env). Ohne Konfig wird nur geloggt.
 */
import { getConfig } from "./config";

const API = (token: string) => `https://api.telegram.org/bot${token}`;

// Lange Nachrichten an Zeilengrenzen in <=4096-Zeichen-Stücke teilen.
function splitForTelegram(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > max) {
      if (cur) out.push(cur);
      if (line.length > max) {
        for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
        cur = "";
      } else cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export async function sendTelegram(
  text: string,
  opts?: { replyTo?: number; buttons?: { text: string; data: string }[][] }
): Promise<{ ok: boolean; skipped?: boolean; messageId?: number }> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  const chatId = await getConfig("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.warn("[telegram] nicht konfiguriert – Nachricht nur im Log:\n" + text);
    return { ok: false, skipped: true };
  }
  const chunks = splitForTelegram(text);
  const replyMarkup = opts?.buttons
    ? { inline_keyboard: opts.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }
    : undefined;

  let ok = true;
  let messageId: number | undefined;
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    const base: Record<string, unknown> = { chat_id: chatId, disable_web_page_preview: true };
    if (last && opts?.replyTo) base.reply_to_message_id = opts.replyTo;
    if (last && replyMarkup) base.reply_markup = replyMarkup;
    try {
      let res = await fetch(`${API(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, text: chunks[i], parse_mode: "HTML" }),
      });
      let json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
      if (!json.ok && /parse|entit/i.test(json.description ?? "")) {
        // HTML nicht parsebar -> als Klartext erneut versuchen
        res = await fetch(`${API(token)}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...base, text: stripTags(chunks[i]) }),
        });
        json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id: number } };
      }
      if (!json.ok) {
        ok = false;
        console.error("[telegram] sendMessage fehlgeschlagen:", json.description);
      }
      if (last) messageId = json.result?.message_id;
    } catch (e) {
      ok = false;
      console.error("[telegram] Senden fehlgeschlagen:", e);
    }
  }
  return { ok, messageId };
}

/** Lädt eine Telegram-Datei (z. B. Sprachnachricht) als Bytes. */
export async function tgDownloadFile(fileId: string): Promise<Buffer | null> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  if (!token) return null;
  const meta = (await (await fetch(`${API(token)}/getFile?file_id=${encodeURIComponent(fileId)}`)).json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  const path = meta.result?.file_path;
  if (!path) return null;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

/** Registriert die Webhook-URL bei Telegram (mit Secret-Token zur Absicherung). */
export async function tgSetWebhook(url: string, secret: string): Promise<{ ok: boolean; description?: string }> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  if (!token) return { ok: false, description: "Kein Bot-Token konfiguriert." };
  const res = await fetch(`${API(token)}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "callback_query"] }),
  });
  return (await res.json()) as { ok: boolean; description?: string };
}

/** Beantwortet einen Button-Klick (entfernt die Lade-Animation, zeigt optional einen Hinweis). */
export async function tgAnswerCallback(callbackId: string, text?: string): Promise<void> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  await fetch(`${API(token)}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: text ?? "" }),
  });
}

/** Ersetzt den Text einer bestehenden Nachricht (z. B. nach „Senden" – Buttons verschwinden). */
export async function tgEditMessage(chatId: number | string, messageId: number, text: string): Promise<void> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  await fetch(`${API(token)}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}
