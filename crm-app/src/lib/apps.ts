/**
 * Die angebundenen Handwerker-Apps (Anzeige-Namen für Oberfläche und
 * Kunden-Zuordnung).
 *
 * ACHTUNG: Muss mit `api/_apps.ts` übereinstimmen — dort stehen zusätzlich die
 * Supabase-projectRefs, die der Datei-Proxy zum Abrufen der Bildschirmfotos
 * braucht. Eine App, die nur hier steht, kann keine Bilder anzeigen.
 */
export interface AppInfo { key: string; label: string }

export const APPS: AppInfo[] = [
  { key: 'willroider', label: 'Holzbau Willroider' },
  { key: 'groismaier', label: 'Groismaier' },
  { key: 'cspowermetall', label: 'CS Powermetall' },
  { key: 'schrettl', label: 'Schrettl' },
  { key: 'monti.pro', label: 'BKS BauKomplettService' },
  { key: 'schafferhoferbau', label: 'Schafferhofer Bau' },
  { key: 'fasching', label: 'Fasching Gebäudetechnik' },
  { key: 'trippl', label: 'Mechanische Instandhaltung Trippl' },
];

export const APP_LABEL: Record<string, string> =
  Object.fromEntries(APPS.map((a) => [a.key, a.label]));
