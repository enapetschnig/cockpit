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

/** Knopf unter einer Nachricht: löst einen Rückruf aus (data) oder öffnet einen Link (url). */
export type TgButton = { text: string; data?: string; url?: string };
const tastatur = (buttons: TgButton[][]) => ({
  inline_keyboard: buttons.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))),
});

export async function sendTelegram(
  text: string,
  // forceReply: Telegram öffnet direkt das Antwortfeld auf diese Nachricht (z. B. „Was soll anders sein?“)
  opts?: { replyTo?: number; buttons?: TgButton[][]; forceReply?: string }
): Promise<{ ok: boolean; skipped?: boolean; messageId?: number }> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  const chatId = await getConfig("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.warn("[telegram] nicht konfiguriert – Nachricht nur im Log:\n" + text);
    return { ok: false, skipped: true };
  }
  const chunks = splitForTelegram(text);
  const replyMarkup = opts?.buttons?.length
    ? tastatur(opts.buttons)
    : opts?.forceReply !== undefined
      ? { force_reply: true, input_field_placeholder: opts.forceReply || undefined }
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

/**
 * Ersetzt den Text (und optional die Knöpfe) einer bestehenden Nachricht. Ohne buttons verschwinden sie.
 * false = nicht geklappt (z. B. über 4096 Zeichen oder Nachricht zu alt) – dann lieber neu senden.
 */
export async function tgEditMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  buttons?: TgButton[][]
): Promise<boolean> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  if (!token) return false;
  const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (buttons && buttons.length) body.reply_markup = tastatur(buttons);
  const senden = async (b: Record<string, unknown>) => {
    try {
      const res = await fetch(`${API(token)}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      return (await res.json()) as { ok: boolean; description?: string };
    } catch (e) {
      return { ok: false, description: String(e) };
    }
  };
  let json = await senden(body);
  if (!json.ok && /parse|entit/i.test(json.description ?? "")) {
    // HTML nicht parsebar -> als Klartext erneut versuchen
    json = await senden({ ...body, text: stripTags(text), parse_mode: undefined });
  }
  // Gleicher Inhalt wie vorher ist kein Fehler (sonst käme die Karte doppelt).
  if (!json.ok && /not modified/i.test(json.description ?? "")) return true;
  if (!json.ok) console.error("[telegram] editMessageText fehlgeschlagen:", json.description);
  return json.ok;
}
