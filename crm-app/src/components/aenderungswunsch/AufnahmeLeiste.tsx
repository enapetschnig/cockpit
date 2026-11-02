import { useEffect, useState } from "react";
import { Square, X } from "lucide-react";
import { AenderungswunschDialog } from "./AenderungswunschDialog";
import {
  AUFNAHME_AUSBLENDEN, AUFNAHME_MAX_SEKUNDEN, aufnahmeBeenden, aufnahmeVerwerfen, meldeEntwurf, useAufnahme,
  type MeldeEntwurf,
} from "@/lib/bildschirmAufnahme";

/**
 * „Zeigen & erklären" (29.10.2026): Während der Aufnahme unten eine Leiste mit
 * Zeit, Verwerfen und „Fertig"; danach geht der Melde-Dialog wieder auf – mit
 * dem, was vorher drinstand (lib/bildschirmAufnahme.ts `meldeEntwurf`).
 *
 * Steht EINMAL in AppLayout: Die Melde-Knöpfe sitzen in den Kopfzeilen der
 * Seiten und verschwinden beim Seitenwechsel, die Leiste muss bleiben.
 * Die Leiste selbst ist nicht in der Aufnahme (AUFNAHME_AUSBLENDEN) und nicht
 * auf dem Bildschirmfoto (data-bildschirmfoto="aus").
 */
export function AufnahmeLeiste() {
  const aufnahme = useAufnahme();
  const [offen, setOffen] = useState(false);
  const [jetzt, setJetzt] = useState(Date.now());
  /** Festgehalten beim Öffnen – „Verwerfen" im Dialog löscht die Aufnahme, der Dialog bleibt offen. */
  const [entwurf, setEntwurf] = useState<MeldeEntwurf | null>(null);

  useEffect(() => {
    if (aufnahme.stand === "fertig") { setEntwurf(meldeEntwurf()); setOffen(true); }
    if (aufnahme.stand !== "laeuft") return;
    const u = window.setInterval(() => setJetzt(Date.now()), 500);
    return () => window.clearInterval(u);
  }, [aufnahme.stand]);

  const sek = aufnahme.stand === "laeuft" ? Math.max(0, Math.floor((jetzt - aufnahme.beginn) / 1000)) : 0;
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

  return (
    <>
      {aufnahme.stand === "laeuft" && (
        <div
          className={`${AUFNAHME_AUSBLENDEN} fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 print:hidden`}
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
          data-bildschirmfoto="aus"
          data-pruef="aufnahme-leiste"
        >
          <div className="flex w-full max-w-md items-center gap-3 rounded-full border bg-background/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse" />
            <span className="min-w-0 flex-1 text-sm leading-tight">
              <span className="font-mono tabular-nums">{mmss(sek)}</span>
              <span className="text-muted-foreground"> / {mmss(AUFNAHME_MAX_SEKUNDEN)}</span>
              <span className="block truncate text-xs text-muted-foreground">Zeigen und Hochdeutsch dazu reden</span>
            </span>
            <button
              type="button"
              onClick={aufnahmeVerwerfen}
              aria-label="Aufnahme verwerfen"
              title="Verwerfen"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void aufnahmeBeenden()}
              className="flex h-9 items-center gap-1.5 rounded-full bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
            >
              <Square className="h-3.5 w-3.5" /> Fertig
            </button>
          </div>
        </div>
      )}

      {/* Nach „Fertig": derselbe Melde-Dialog, die Aufnahme ist dabei. */}
      {(aufnahme.stand === "fertig" || offen) && (
        <AenderungswunschDialog
          open={offen}
          onOpenChange={setOffen}
          bild={entwurf?.bild ?? null}
          seite={entwurf?.seite}
        />
      )}
    </>
  );
}
