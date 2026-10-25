/**
 * Nur interne Pfade – kein Sprung auf fremde Seiten über ?next=.
 * Geprüft wird, wohin der Browser den Pfad WIRKLICH auflöst: „/\boese.tld“ oder
 * „/<Tab>/boese.tld“ beginnen mit „/“, landen aber auf einer fremden Seite.
 */
export function sichererPfad(p: string | null): string {
  if (!p || !p.startsWith('/')) return '/';
  try {
    const u = new URL(p, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}
