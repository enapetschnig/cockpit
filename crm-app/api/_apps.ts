/**
 * Die angebundenen Handwerker-Apps. Jede App schickt ihre Meldungen selbst
 * hierher (Datenbank-Trigger) – wir brauchen daher KEINE Supabase-Schlüssel
 * der Apps, nur die projectRef für den Datei-Abruf und das gemeinsame
 * Geheimnis FEEDBACK_SHARED_SECRET.
 */
export interface AppInfo { key: string; label: string; projectRef: string }

export const APPS: AppInfo[] = [
  { key: 'willroider', label: 'Holzbau Willroider', projectRef: 'ylqbxnsxksbtsqrcwtuq' },
  { key: 'groismaier', label: 'Groismaier', projectRef: 'tdehljzmqwmfgfoyyoee' },
  { key: 'cspowermetall', label: 'CS Powermetall', projectRef: 'jtdkilylwpgwqumzkdne' },
  { key: 'schrettl', label: 'Schrettl', projectRef: 'pwzfplzwmufvfjaubfcp' },
  { key: 'monti.pro', label: 'Monti.pro', projectRef: 'zbxizeirecoipqvxymdx' },
];

const BY_KEY = new Map(APPS.map((a) => [a.key, a]));
export const appInfo = (key: string): AppInfo | undefined => BY_KEY.get(key);
export const appLabel = (key: string): string => BY_KEY.get(key)?.label ?? key;

/** Zeitsicherer Vergleich – verhindert, dass man das Secret über die Antwortzeit errät. */
export function secretGleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Telegram-Push. Ohne Konfiguration wird nur geloggt – der Eingang darf daran nie scheitern. */
export async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { console.warn('[telegram] nicht konfiguriert:', text); return; }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error('[telegram] Senden fehlgeschlagen:', e);
  }
}
