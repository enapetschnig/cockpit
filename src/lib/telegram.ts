/**
 * Telegram-Push. Sendet eine Nachricht an den konfigurierten Chat.
 * Ohne TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID wird nur geloggt (App läuft trotzdem).
 *
 * Setup:
 *  1) Bot bei @BotFather erstellen -> Token in .env (TELEGRAM_BOT_TOKEN)
 *  2) Bot anschreiben, dann Chat-ID via @userinfobot holen -> TELEGRAM_CHAT_ID
 */
import { getConfig } from "./config";

export async function sendTelegram(text: string): Promise<{ ok: boolean; skipped?: boolean }> {
  const token = await getConfig("TELEGRAM_BOT_TOKEN");
  const chatId = await getConfig("TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    console.warn("[telegram] nicht konfiguriert – Nachricht nur im Log:\n" + text);
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const json = (await res.json()) as { ok: boolean };
    return { ok: !!json.ok };
  } catch (e) {
    console.error("[telegram] Senden fehlgeschlagen:", e);
    return { ok: false };
  }
}
