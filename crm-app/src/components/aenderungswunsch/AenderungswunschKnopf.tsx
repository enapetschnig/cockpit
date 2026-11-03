import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { bildschirmfotoMachen } from "@/lib/bildschirmfoto";
import { AenderungswunschDialog } from "./AenderungswunschDialog";
import { AufnahmeLeiste } from "./AufnahmeLeiste";
import { aufnahmeStand, useAufnahme } from "@/lib/bildschirmAufnahme";

/**
 * „Änderung melden" fürs Cockpit selbst (02.11.2026, Vorlage Steinbrecher).
 *
 * Ein kleiner runder Knopf rechts unten, nur angemeldet – dezent, das Cockpit
 * bleibt schlank. ERST das Bildschirmfoto, DANN der Dialog (sonst wäre nur das
 * Meldefenster auf dem Bild). Während „Zeigen & erklären" läuft, ist er weg,
 * dann gilt die Leiste unten.
 */
export function CockpitMelden() {
  const { user } = useAuth();
  const ort = useLocation();
  const aufnahme = useAufnahme();
  const [offen, setOffen] = useState(false);
  const [bild, setBild] = useState<string | null>(null);
  const [seite, setSeite] = useState("");
  const [arbeitet, setArbeitet] = useState(false);

  // In einer Claude-Sitzung schreibt man ohnehin direkt an Claude – dort läge der Knopf auf dem Senden-Knopf.
  if (!user || ort.pathname.startsWith("/auth") || /^\/apps\/[^/]+\/[^/]+/.test(ort.pathname)) return null;

  const starten = async () => {
    if (aufnahmeStand() === "laeuft" || aufnahmeStand() === "startet") return;
    setArbeitet(true);
    setSeite(ort.pathname);
    try {
      setBild(await bildschirmfotoMachen());
    } catch {
      setBild(null);
    }
    setArbeitet(false);
    setOffen(true);
  };

  return (
    <>
      {aufnahme.stand !== "laeuft" && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void starten()}
          disabled={arbeitet}
          title="Änderung melden – Bild vom Bildschirm ist automatisch dabei"
          aria-label="Änderung melden"
          data-bildschirmfoto="aus"
          // Im Beleg-Editor liegt unten die Aktionsleiste – dann darüber. Am Handy über der Leiste unten (--unten).
          className={`fixed ${ort.pathname.startsWith("/beleg/") ? "bottom-24" : "bottom-[calc(var(--unten)+1rem)]"} right-4 z-40 h-10 w-10 rounded-full shadow-md bg-background/90 backdrop-blur hover:bg-accent print:hidden`}
        >
          <MessageSquarePlus className="h-5 w-5" />
        </Button>
      )}
      <AenderungswunschDialog open={offen} onOpenChange={setOffen} bild={bild} seite={seite || ort.pathname} />
      <AufnahmeLeiste />
    </>
  );
}
