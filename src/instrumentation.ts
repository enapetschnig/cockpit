/**
 * Next.js Instrumentation – läuft einmal beim Serverstart.
 * Startet den Auto-Sync: alle SYNC_INTERVAL_MS (Standard 2 Min) wird die bestehende
 * Sync-Route per fetch angestoßen (holt neue Gmail-Nachrichten, klassifiziert, pusht).
 *
 * Wichtig: Hier wird googleapis NICHT importiert (sonst Bundling-Fehler in der
 * Instrumentation). Wir triggern nur den HTTP-Endpunkt der eigenen App.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __cockpitAutoSync?: boolean };
  if (g.__cockpitAutoSync) return;
  g.__cockpitAutoSync = true;

  const intervalMs = Math.max(30_000, Number(process.env.SYNC_INTERVAL_MS) || 120_000);
  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}/api/gmail/sync`;

  const tick = async () => {
    try {
      const res = await fetch(url, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as {
        imported?: number;
        perAccount?: Record<string, number>;
        errors?: string[];
      };
      if (d.imported && d.imported > 0) console.log(`[auto-sync] ${d.imported} neue Mail(s)`, d.perAccount);
      else if (d.errors?.length) console.warn("[auto-sync] Hinweise:", d.errors);
    } catch (e) {
      console.error("[auto-sync] fehlgeschlagen:", (e as Error).message);
    }
  };

  // Erster Lauf kurz nach Start (Server muss lauschen), danach im Intervall.
  setTimeout(tick, 15_000);
  setInterval(tick, intervalMs);
  console.log(`[auto-sync] aktiv – alle ${Math.round(intervalMs / 1000)}s -> ${url}`);
}
