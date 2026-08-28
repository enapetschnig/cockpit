/**
 * Die angebundenen Handwerker-Apps. Jede App schickt ihre Wünsche/Fehler
 * selbst ans Cockpit (Datenbank-Trigger) – das Cockpit braucht daher KEINE
 * Supabase-Schlüssel der Apps, nur die projectRef für den Datei-Abruf und
 * das gemeinsame Geheimnis FEEDBACK_SHARED_SECRET.
 */
export interface AppInfo { key: string; label: string; projectRef: string }

export const APPS: AppInfo[] = [
  { key: "groismaier", label: "Groismaier", projectRef: "tdehljzmqwmfgfoyyoee" },
  { key: "cspowermetall", label: "CS Powermetall", projectRef: "jtdkilylwpgwqumzkdne" },
  { key: "schrettl", label: "Schrettl", projectRef: "pwzfplzwmufvfjaubfcp" },
  { key: "monti.pro", label: "Monti.pro", projectRef: "zbxizeirecoipqvxymdx" },
];

const BY_KEY = new Map(APPS.map((a) => [a.key, a]));

export const appInfo = (key: string): AppInfo | undefined => BY_KEY.get(key);
/** Unbekannte Apps sollen trotzdem lesbar angezeigt werden. */
export const appLabel = (key: string): string => BY_KEY.get(key)?.label ?? key;

/** Zeitsicherer Vergleich – verhindert, dass man das Secret über die Antwortzeit errät. */
export function secretGleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
