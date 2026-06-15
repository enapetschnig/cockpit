/**
 * Telegram – Senden, Datei-Download (Sprachnachrichten), Webhook-Setup.
 * Token/Chat-ID kommen aus der Config (Supabase/Env). Ohne Konfig wird nur geloggt.
 */
import { getConfig } from "./config";

const API = (token: string) => `https://api.telegram.org/bot${token}`;

export async function sendTelegram(
  text: string,
  opts?: { replyTo?: number }
): Promise<{ ok: boolean; skipped?: boolean; messageId?: number }> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  const chatId = await getConfig("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.warn("[telegram] nicht konfiguriert – Nachricht nur im Log:\n" + text);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(`${API(token)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(opts?.replyTo ? { reply_to_message_id: opts.replyTo } : {}),
      }),
    });
    const json = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    return { ok: !!json.ok, messageId: json.result?.message_id };
  } catch (e) {
    console.error("[telegram] Senden fehlgeschlagen:", e);
    return { ok: false };
  }
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
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message"] }),
  });
  return (await res.json()) as { ok: boolean; description?: string };
}
