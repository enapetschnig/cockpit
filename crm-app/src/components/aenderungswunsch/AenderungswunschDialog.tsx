import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bug, HelpCircle, Lightbulb, Loader2, Maximize2, Mic, MonitorPlay, Pencil, Send, Square, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { datenUrlZuBlob } from "@/lib/bildschirmfoto";
import { BildMarkierenDialog } from "./BildMarkierenDialog";
import {
  aufnahmeMoeglich, aufnahmeStarten as vorfuehrenStarten, aufnahmeVerwerfen, meldeEntwurf, tonAufnahmeTyp, useAufnahme,
} from "@/lib/bildschirmAufnahme";

/**
 * Cockpit (02.11.2026): Die Meldung geht direkt in crm.app_wuensche (app_key
 * 'cockpit') – das Cockpit IST die Wünsche-Ablage, der Roboter holt sie dort ab.
 * Dateien im privaten Ablagebereich `cockpit-wuensche`; der Pfad am Wunsch
 * trägt den Bereich vorne („cockpit-wuensche/<uid>/…"), so finden Roboter und
 * Datei-Proxy (api/wuensche-datei.ts) den Speicher.
 */
const BEREICH = "cockpit-wuensche";
const wunschTable = () => (supabase.schema("crm" as never) as any).from("app_wuensche");
const hochladen = async (pfad: string, datei: Blob, typ: string) => {
  const { error } = await supabase.storage.from(BEREICH).upload(pfad, datei, { contentType: typ });
  return error ? error : `${BEREICH}/${pfad}`;
};

type Art = "wunsch" | "fehler" | "frage";

const ARTEN: { wert: Art; titel: string; zeichen: typeof Lightbulb; hilfe: string }[] = [
  { wert: "fehler", titel: "Passt nicht", zeichen: Bug, hilfe: "Geht nicht oder ist falsch" },
  { wert: "wunsch", titel: "Wunsch", zeichen: Lightbulb, hilfe: "Fehlt oder wäre einfacher" },
  { wert: "frage", titel: "Frage", zeichen: HelpCircle, hilfe: "Ich weiß nicht, wie das geht" },
];

const dateiEndung = (mime: string) => {
  const clean = (mime || "").split(";")[0].trim().toLowerCase();
  if (clean.includes("mp4")) return "mp4";
  if (clean.includes("ogg")) return "ogg";
  if (clean.includes("mpeg") || clean.includes("mp3")) return "mp3";
  if (clean.includes("wav")) return "wav";
  return "webm";
};

interface Props {
  open: boolean;
  onOpenChange: (offen: boolean) => void;
  /** Das VOR dem Öffnen aufgenommene Bild. Null = ohne Bild melden. */
  bild: string | null;
  /** Seite, auf der die Aufnahme entstand. */
  seite?: string;
}

/**
 * Änderungswunsch melden.
 *
 * Der Ablauf ist auf "unterwegs, eine Hand frei" gebaut: Das Bildschirmfoto
 * ist schon da, die Art ist mit einem Tipp gewählt, und statt zu tippen redet
 * man einfach. Die Sprachnachricht wird MITGESCHICKT und erst danach im
 * Hintergrund abgeschrieben (Edge Function `sprache-zu-text`) — niemand
 * wartet auf die KI, und bei schlechtem Netz geht die Meldung trotzdem raus.
 */
export function AenderungswunschDialog({ open, onOpenChange, bild, seite }: Props) {
  const ort = useLocation();
  const { toast } = useToast();
  const [art, setArt] = useState<Art>("fehler");
  const [text, setText] = useState("");
  const [bildJetzt, setBildJetzt] = useState<string | null>(bild);
  const [sendet, setSendet] = useState(false);
  /** Vollbild zum Ansehen und Einkreisen. */
  const [markieren, setMarkieren] = useState(false);

  // Aufnahme
  const [nimmtAuf, setNimmtAuf] = useState(false);
  const [sekunden, setSekunden] = useState(0);
  const [aufnahmeBlob, setAufnahmeBlob] = useState<Blob | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stuecke = useRef<Blob[]>([]);
  const uhr = useRef<ReturnType<typeof setInterval> | null>(null);

  // „Zeigen & erklären" (Bildschirmaufnahme + Ton) — zusätzlich zu allem oben.
  const vorfuehrung = useAufnahme();
  const vorgefuehrt = vorfuehrung.stand === "fertig" ? vorfuehrung.aufnahme : null;
  const [startetVorfuehrung, setStartetVorfuehrung] = useState(false);

  useEffect(() => {
    if (open) {
      setBildJetzt(bild);
      // Nach dem Vorführen: Was vorher im Dialog stand, kommt wieder hinein.
      const e = vorgefuehrt ? meldeEntwurf() : null;
      if (e) {
        if (ARTEN.some((a) => a.wert === e.art)) setArt(e.art as Art);
        setText((t) => t.trim() ? t : e.text);
      }
    } else {
      // Beim Schließen alles zurücksetzen — auch ein laufendes Mikrofon.
      rec.current?.stream.getTracks().forEach((t) => t.stop());
      rec.current = null;
      if (uhr.current) clearInterval(uhr.current);
      setNimmtAuf(false);
      setSekunden(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Öffnen übernehmen
  }, [open, bild]);

  const zuruecksetzen = () => {
    aufnahmeVerwerfen();
    setArt("fehler");
    setText("");
    setBildJetzt(null);
    setAufnahmeBlob(null);
    setSekunden(0);
  };

  const aufnahmeStarten = async () => {
    try {
      const strom = await navigator.mediaDevices.getUserMedia({ audio: true });
      const typ = tonAufnahmeTyp();
      const r = new MediaRecorder(strom, typ ? { mimeType: typ } : undefined);
      stuecke.current = [];
      r.ondataavailable = (e) => { if (e.data.size) stuecke.current.push(e.data); };
      r.onstop = () => {
        strom.getTracks().forEach((t) => t.stop());
        const blob = new Blob(stuecke.current, { type: typ || "audio/webm" });
        if (blob.size < 1000) {
          toast({ title: "Die Aufnahme war zu kurz", description: "Noch einmal versuchen?" });
          setAufnahmeBlob(null);
          setSekunden(0);
          return;
        }
        setAufnahmeBlob(blob);
      };
      r.start();
      rec.current = r;
      setSekunden(0);
      setNimmtAuf(true);
      uhr.current = setInterval(() => setSekunden((s) => s + 1), 1000);
    } catch {
      toast({
        variant: "destructive",
        title: "Kein Zugriff aufs Mikrofon",
        description: "In den Einstellungen des Browsers freigeben.",
      });
    }
  };

  /** Dialog zu, vorführen, mit „Fertig" geht er wieder auf (AufnahmeLeiste). */
  const vorfuehren = async () => {
    setStartetVorfuehrung(true);
    try {
      await vorfuehrenStarten({ art, text, bild: bildJetzt, seite: seite ?? ort.pathname });
      onOpenChange(false);
    } catch {
      toast({
        variant: "destructive",
        title: "Kein Zugriff aufs Mikrofon",
        description: "In den Einstellungen des Browsers freigeben — oder einfach tippen.",
      });
    } finally {
      setStartetVorfuehrung(false);
    }
  };

  const aufnahmeBeenden = () => {
    rec.current?.stop();
    rec.current = null;
    if (uhr.current) clearInterval(uhr.current);
    setNimmtAuf(false);
  };

  const senden = async () => {
    if (!text.trim() && !aufnahmeBlob && !vorgefuehrt) {
      toast({
        variant: "destructive",
        title: "Nichts zu melden",
        description: "Kurz sagen oder tippen, was anders sein soll.",
      });
      return;
    }
    setSendet(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Nicht angemeldet.");

      // 1. Bild hochladen — scheitert es, geht die Meldung trotzdem raus.
      let bildPfad: string | null = null;
      if (bildJetzt) {
        const r = await hochladen(`${user.id}/${Date.now()}-bild.jpg`, datenUrlZuBlob(bildJetzt), "image/jpeg");
        if (typeof r === "string") bildPfad = r;
      }

      // 2. Sprachnachricht hochladen.
      let audioPfad: string | null = null;
      if (aufnahmeBlob) {
        const r = await hochladen(`${user.id}/${Date.now()}-ton.${dateiEndung(aufnahmeBlob.type)}`, aufnahmeBlob, aufnahmeBlob.type || "audio/webm");
        if (typeof r !== "string") throw new Error(`Sprachnachricht nicht hochgeladen: ${r.message}`);
        audioPfad = r;
      }

      // 2b. Vorführung: Bildschirm-Aufzeichnung + Ton (der Ton ist dann die
      //     Sprachnachricht — die Abschrift bekommt den Ablauf dazu).
      let aufnahmePfad: string | null = null;
      if (vorgefuehrt) {
        const r = await hochladen(`${user.id}/${Date.now()}-aufnahme.json.gz`, vorgefuehrt.bildschirm, "application/gzip");
        if (typeof r !== "string") throw new Error(`Aufnahme nicht hochgeladen: ${r.message}`);
        aufnahmePfad = r;
        if (vorgefuehrt.ton && !audioPfad) {
          const t = await hochladen(`${user.id}/${Date.now()}-ton.${dateiEndung(vorgefuehrt.ton.type)}`, vorgefuehrt.ton, vorgefuehrt.ton.type || "audio/webm");
          if (typeof t !== "string") throw new Error(`Ton der Aufnahme nicht hochgeladen: ${t.message}`);
          audioPfad = t;
        }
      }

      // 3. Wunsch anlegen. Mit Ton kommt der Text gleich von der Edge Function
      //    (wunsch-abschrift hängt ihn an).
      const { data: neu, error } = await wunschTable()
        .insert({
          id: crypto.randomUUID(),
          app_key: "cockpit",
          status: "neu",
          melder: "Christoph Napetschnig",
          text: text.trim() || (vorgefuehrt && !audioPfad ? "Bildschirmaufnahme (ohne Ton)" : ""),
          art,
          seite: seite ?? ort.pathname,
          bild_pfad: bildPfad,
          audio_pfad: audioPfad,
          anhaenge: [],
          ...(aufnahmePfad ? {
            aufnahme_pfad: aufnahmePfad,
            aufnahme_ablauf: { sekunden: vorgefuehrt?.sekunden ?? 0, schritte: vorgefuehrt?.ablauf ?? [] },
          } : {}),
        })
        .select("id")
        .single();
      if (error) throw error;

      // 4. Abschrift im Hintergrund anstoßen — bewusst OHNE await:
      //    Der Dialog schließt sofort, die KI arbeitet nach.
      if (audioPfad && neu?.id) {
        supabase.functions
          .invoke("wunsch-abschrift", { body: { wunschId: neu.id } })
          .catch(() => { /* Die Funktion trägt Fehler selbst am Wunsch ein. */ });
      }

      toast({
        title: "Ist beim Roboter",
        description: aufnahmePfad
          ? "Die Aufnahme wird gerade ausgewertet."
          : audioPfad
          ? "Die Sprachnachricht wird gerade abgeschrieben."
          : undefined,
      });
      zuruecksetzen();
      onOpenChange(false);
    } catch (f) {
      toast({
        variant: "destructive",
        title: "Konnte nicht gesendet werden",
        description: f instanceof Error ? f.message : undefined,
      });
    } finally {
      setSendet(false);
    }
  };

  const mmss = `${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sendet) onOpenChange(false); }}>
      <DialogContent
        className="sm:max-w-lg max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0"
        data-bildschirmfoto="aus"
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b text-left">
          <DialogTitle>Was soll im Cockpit anders sein?</DialogTitle>
          <DialogDescription>
            Das Bild vom Bildschirm ist schon dabei – der Roboter setzt es um.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {/* Art */}
          <div className="space-y-2">
            <Label>Worum geht es?</Label>
            <div className="grid grid-cols-3 gap-2">
              {ARTEN.map((a) => (
                <button
                  key={a.wert}
                  type="button"
                  onClick={() => setArt(a.wert)}
                  className={cn(
                    "flex h-full flex-col items-center gap-1 rounded-md border-2 p-2 text-center text-xs leading-tight transition-colors",
                    art === a.wert ? "border-primary bg-primary/5" : "border-muted bg-popover hover:bg-accent",
                  )}
                >
                  <a.zeichen className="h-5 w-5" />
                  <span className="font-medium">{a.titel}</span>
                  <span className="text-[0.68rem] font-normal text-muted-foreground">{a.hilfe}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Vorführen: Bildschirmaufnahme mit Ton — zusätzlich, nichts davon ist Pflicht. */}
          {(vorgefuehrt || aufnahmeMoeglich()) && (
            <div className="space-y-2">
              <Label>Zeigen statt beschreiben</Label>
              {vorgefuehrt ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                  <MonitorPlay className="h-4 w-4 shrink-0" />
                  <span className="flex-1 min-w-40">
                    Aufnahme ({Math.floor(vorgefuehrt.sekunden / 60)}:{String(vorgefuehrt.sekunden % 60).padStart(2, "0")})
                    {vorgefuehrt.ton ? " mit Ton" : " ohne Ton"} ist dabei.
                  </span>
                  <Button
                    type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                    onClick={aufnahmeVerwerfen}
                  >
                    <Trash2 className="h-4 w-4" /> Verwerfen
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-3 space-y-2">
                  <Button type="button" variant="outline" size="sm" className="gap-2 w-full"
                    disabled={startetVorfuehrung || nimmtAuf}
                    data-pruef="aufnahme-starten"
                    onClick={() => void vorfuehren()}>
                    {startetVorfuehrung ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorPlay className="h-4 w-4" />}
                    Bildschirm aufnehmen & erklären
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Das Fenster geht zu, du klickst dich durch die App und sagst dazu, was anders
                    sein soll — <b className="text-foreground">bitte Hochdeutsch</b>. Mit „Fertig"
                    unten kommst du hierher zurück. Höchstens 5 Minuten.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Sprachnachricht (entfällt, wenn die Vorführung schon Ton hat) */}
          {!vorgefuehrt?.ton && <div className="space-y-2">
            <Label>Sagen statt tippen</Label>
            <div className="rounded-md border border-dashed p-3 space-y-2">
              {aufnahmeBlob ? (
                <div className="flex flex-wrap items-center gap-2">
                  <audio controls src={URL.createObjectURL(aufnahmeBlob)} className="h-9 flex-1 min-w-40" />
                  <Button
                    type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground"
                    onClick={() => { setAufnahmeBlob(null); setSekunden(0); }}
                  >
                    <Trash2 className="h-4 w-4" /> Verwerfen
                  </Button>
                </div>
              ) : nimmtAuf ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                    Nimmt auf … <span className="font-mono tabular-nums">{mmss}</span>
                  </span>
                  <Button type="button" variant="destructive" size="sm" className="gap-2 ml-auto"
                    onClick={aufnahmeBeenden}>
                    <Square className="h-4 w-4" /> Fertig
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="gap-2 w-full"
                  onClick={() => void aufnahmeStarten()}>
                  <Mic className="h-4 w-4" /> Sprachnachricht aufnehmen
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                <b className="text-foreground">Bitte Hochdeutsch sprechen</b> — die Aufnahme wird
                automatisch abgeschrieben, und im Dialekt versteht die Technik oft das Falsche.
                Du musst nicht warten: Abschicken, das Abschreiben läuft im Hintergrund.
              </p>
            </div>
          </div>}

          {/* Text */}
          <div className="space-y-2">
            <Label htmlFor="wunsch-text">… oder tippen (optional)</Label>
            <Textarea
              id="wunsch-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Zum Beispiel: Der Knopf zum Speichern ist ganz unten, ich muss jedes Mal scrollen."
              className="min-h-20"
            />
          </div>

          {/* Bild */}
          <div className="space-y-2">
            <Label>Bild vom Bildschirm</Label>
            {bildJetzt ? (
              <div className="space-y-2">
                {/* Waagrecht schiebbar: Das Bild zeigt die volle Inhaltsbreite,
                    auch wenn rechts etwas aus dem Fenster ragte. */}
                {/* Vorschau klein, zum Ansehen und Einkreisen geht es aufs
                    ganze Bild — das ist übersichtlicher als Hin- und
                    Herschieben in einem Guckloch. */}
                <button
                  type="button"
                  onClick={() => setMarkieren(true)}
                  className="group relative block w-full overflow-hidden rounded-md border bg-muted/30"
                  title="Groß ansehen und einkreisen"
                >
                  <img src={bildJetzt} alt="Bildschirm" className="max-h-44 w-full object-contain" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                    <span className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-xs font-medium opacity-0 shadow transition-opacity group-hover:opacity-100">
                      <Maximize2 className="h-3.5 w-3.5" /> Groß ansehen & einkreisen
                    </span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-2"
                    onClick={() => setMarkieren(true)}>
                    <Pencil className="h-4 w-4" /> Einkreisen
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="gap-2 text-muted-foreground ml-auto"
                    onClick={() => setBildJetzt(null)}>
                    <Trash2 className="h-4 w-4" /> Ohne Bild
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                Kein Bild dabei. Der Hinweis allein hilft auch.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Mitgeschickt wird auch, auf welcher Seite du warst ({seite ?? ort.pathname}) —
            damit niemand raten muss.
          </p>
        </div>

        <DialogFooter className="px-5 py-4 border-t bg-background flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sendet}>
            Abbrechen
          </Button>
          <Button onClick={() => void senden()} disabled={sendet || nimmtAuf || (!text.trim() && !aufnahmeBlob && !vorgefuehrt)} className="gap-2">
            {sendet ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sendet ? "Wird gesendet…" : "Abschicken"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Vollbild zum Einkreisen — liegt über dem Melde-Dialog. */}
      {bildJetzt && (
        <BildMarkierenDialog
          open={markieren}
          bild={bildJetzt}
          onAbbrechen={() => setMarkieren(false)}
          onFertig={(neuesBild) => { setBildJetzt(neuesBild); setMarkieren(false); }}
        />
      )}
    </Dialog>
  );
}
