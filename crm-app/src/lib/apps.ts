/** Die angebundenen Handwerker-Apps (Anzeige-Namen für den Wünsche-Bereich). */
export interface AppInfo { key: string; label: string }

export const APPS: AppInfo[] = [
  { key: 'groismaier', label: 'Groismaier' },
  { key: 'cspowermetall', label: 'CS Powermetall' },
  { key: 'schrettl', label: 'Schrettl' },
  { key: 'monti.pro', label: 'Monti.pro' },
];

export const APP_LABEL: Record<string, string> =
  Object.fromEntries(APPS.map((a) => [a.key, a.label]));
