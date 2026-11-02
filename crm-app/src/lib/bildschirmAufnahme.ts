/**
 * „Zeigen & erklären" beim Änderung melden (29.10.2026).
 *
 * Der Melder führt in der App vor, was anders sein soll, und redet dazu.
 * Aufgenommen wird KEIN Video: Am Handy (iPhone wie Android) kann eine Web-App
 * den Bildschirm gar nicht filmen (getDisplayMedia fehlt dort). Stattdessen
 * zeichnet rrweb die Seite selbst auf (Aufbau + jede Änderung, Klick, Scrollen)
 * — das geht in jedem Browser gleich, ohne Freigabe-Dialog, und Passwortfelder
 * bleiben maskiert. Das Mikrofon läuft parallel über MediaRecorder, mit
 * derselben Formatwahl wie die Sprachnachricht (Safari: mp4).
 *
 * Nebenbei entsteht ein kurzer Ablauf (Sekunde → Seite bzw. angetippter Knopf).
 * Den bekommt die Abschrift am Server dazu: so steht bei jedem Satz, wo der
 * Melder gerade war — daraus werden die einzelnen Wünsche.
 *
 * Die Aufnahme gehört bewusst nicht dem Dialog: Der ist während des Vorführens
 * zu, und die Aufnahme muss Seitenwechsel überleben. Daher ein kleiner
 * Modul-Zustand mit useSyncExternalStore.
 *
 * Cockpit (02.11.2026, Vorlage Steinbrecher): Der Melde-Knopf schwebt rechts
 * unten (components/aenderungswunsch/AenderungswunschKnopf.tsx). Das Modul merkt
 * sich beim Start, was im Dialog schon stand (`entwurf`), und
 * components/aenderungswunsch/AufnahmeLeiste.tsx (einmal in App.tsx) zeigt die
 * Leiste und öffnet nach „Fertig" den Dialog wieder damit.
 */

import { useSyncExternalStore } from "react";
import { gzipSync, strToU8 } from "fflate";

/** Längste Aufnahme. Danach stoppt sie von selbst (Dateigröße, Abschrift). */
export const AUFNAHME_MAX_SEKUNDEN = 5 * 60;

/** Elemente mit dieser Klasse landen nicht in der Aufnahme (die Aufnahmeleiste). */
export const AUFNAHME_AUSBLENDEN = "aufnahme-ausblenden";

export interface AblaufSchritt {
  /** Sekunden seit Beginn */
  t: number;
  art: "seite" | "klick";
  text: string;
}

export interface FertigeAufnahme {
  /** rrweb-Ereignisse, gzip-gepackt (JSON) */
  bildschirm: Blob;
  ton: Blob | null;
  ablauf: AblaufSchritt[];
  sekunden: number;
}

type Zustand =
  | { stand: "aus" }
  | { stand: "startet" }
  | { stand: "laeuft"; beginn: number }
  | { stand: "fertig"; aufnahme: FertigeAufnahme };

let zustand: Zustand = { stand: "aus" };
const hoerer = new Set<() => void>();
const setzen = (z: Zustand) => { zustand = z; hoerer.forEach((h) => h()); };

/** Was im Melde-Dialog vor dem Vorführen schon stand – kommt nach „Fertig" wieder hinein. */
export interface MeldeEntwurf {
  art: string;
  text: string;
  bild: string | null;
  seite: string;
}
let entwurf: MeldeEntwurf | null = null;
export const meldeEntwurf = (): MeldeEntwurf | null => entwurf;

export const aufnahmeStand = (): Zustand["stand"] => zustand.stand;
/** Die fertige Aufnahme (ohne React, z. B. für Prüfskripte). */
export const fertigeAufnahme = (): FertigeAufnahme | null => (zustand.stand === "fertig" ? zustand.aufnahme : null);

export function useAufnahme(): Zustand {
  return useSyncExternalStore(
    (h) => { hoerer.add(h); return () => hoerer.delete(h); },
    () => zustand,
    () => zustand,
  );
}

/** Aufnahmeformat aushandeln — Safari kann kein webm/opus. */
export function tonAufnahmeTyp(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

/** Was ein Mensch auf dem angetippten Element liest — kurz. */
function beschriftung(ziel: EventTarget | null): string | null {
  if (!(ziel instanceof Element)) return null;
  if (ziel.closest(`.${AUFNAHME_AUSBLENDEN}`)) return null;
  const el = ziel.closest("button, a, [role=button], [role=tab], [role=menuitem], [role=option], label, input, select, textarea, th, td, li") ?? ziel;
  if (el instanceof HTMLInputElement && el.type === "password") return "Passwortfeld";
  const roh =
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.placeholder || el.name : "") ||
    (el as HTMLElement).innerText ||
    el.textContent ||
    "";
  const text = roh.replace(/\s+/g, " ").trim().slice(0, 80);
  const tag = el.tagName.toLowerCase();
  const was = tag === "a" ? "Link" : tag === "button" || el.getAttribute("role") === "button" ? "Knopf"
    : tag === "input" || tag === "textarea" || tag === "select" ? "Feld" : "";
  if (!text) return was ? `${was} ohne Beschriftung` : null;
  return was ? `${was} „${text}"` : `„${text}"`;
}

// Laufende Aufnahme
let stopRrweb: (() => void) | undefined;
let rec: MediaRecorder | null = null;
let strom: MediaStream | null = null;
let ereignisse: unknown[] = [];
let tonStuecke: Blob[] = [];
let ablauf: AblaufSchritt[] = [];
let beginn = 0;
let seitenUhr: ReturnType<typeof setInterval> | null = null;
let endeUhr: ReturnType<typeof setTimeout> | null = null;
let letzteSeite = "";

const sekundeJetzt = () => Math.round((Date.now() - beginn) / 100) / 10;

const beiKlick = (e: Event) => {
  const text = beschriftung(e.target);
  if (text) ablauf.push({ t: sekundeJetzt(), art: "klick", text });
};

const seitePruefen = () => {
  const seite = location.pathname + location.search;
  if (seite !== letzteSeite) {
    letzteSeite = seite;
    ablauf.push({ t: sekundeJetzt(), art: "seite", text: seite });
  }
};

function aufraeumen() {
  stopRrweb?.();
  stopRrweb = undefined;
  document.removeEventListener("click", beiKlick, true);
  if (seitenUhr) clearInterval(seitenUhr);
  if (endeUhr) clearTimeout(endeUhr);
  seitenUhr = null;
  endeUhr = null;
  strom?.getTracks().forEach((t) => t.stop());
  strom = null;
}

/**
 * Startet Mikrofon + Aufzeichnung. MUSS direkt aus einem Tipp kommen
 * (iPhone gibt das Mikrofon sonst nicht frei). Wirft bei verweigertem Mikrofon.
 */
export async function aufnahmeStarten(vorher?: MeldeEntwurf): Promise<void> {
  if (zustand.stand === "laeuft" || zustand.stand === "startet") return;
  entwurf = vorher ?? null;
  setzen({ stand: "startet" });
  try {
    strom = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (f) {
    entwurf = null;
    setzen({ stand: "aus" });
    throw f;
  }
  // rrweb erst jetzt laden — es soll den normalen App-Start nicht bremsen.
  let record: typeof import("rrweb").record;
  try {
    ({ record } = await import("rrweb"));
  } catch (f) {
    aufraeumen();
    entwurf = null;
    setzen({ stand: "aus" });
    throw f;
  }

  ereignisse = [];
  tonStuecke = [];
  ablauf = [];
  letzteSeite = "";
  beginn = Date.now();

  const typ = tonAufnahmeTyp();
  rec = new MediaRecorder(strom, typ ? { mimeType: typ } : undefined);
  rec.ondataavailable = (e) => { if (e.data.size) tonStuecke.push(e.data); };
  // In Stücken: bricht etwas ab, ist wenigstens das Bisherige da.
  rec.start(1000);

  stopRrweb = record({
    emit: (e) => { ereignisse.push(e); },
    blockClass: AUFNAHME_AUSBLENDEN,
    maskInputOptions: { password: true },
    sampling: { mousemove: 100, scroll: 150, input: "last" },
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
  }) ?? undefined;

  document.addEventListener("click", beiKlick, true);
  seitePruefen();
  seitenUhr = setInterval(seitePruefen, 300);
  endeUhr = setTimeout(() => { void aufnahmeBeenden(); }, AUFNAHME_MAX_SEKUNDEN * 1000);
  setzen({ stand: "laeuft", beginn });
}

/** Stoppt und packt die Aufnahme. Danach steht sie als „fertig" bereit. */
export async function aufnahmeBeenden(): Promise<void> {
  if (zustand.stand !== "laeuft") return;
  const sekunden = Math.round((Date.now() - beginn) / 1000);
  const r = rec;
  rec = null;
  const tonFertig = new Promise<void>((ok) => {
    if (!r || r.state === "inactive") return ok();
    r.onstop = () => ok();
    try { r.stop(); } catch { ok(); }
  });
  stopRrweb?.();
  stopRrweb = undefined;
  await tonFertig;
  const tonTyp = r?.mimeType || tonAufnahmeTyp() || "audio/webm";
  aufraeumen();

  const ton = tonStuecke.length ? new Blob(tonStuecke, { type: tonTyp }) : null;
  const gepackt = gzipSync(strToU8(JSON.stringify({ version: 1, sekunden, ereignisse })), { level: 6 });
  const bildschirm = new Blob([gepackt], { type: "application/gzip" });
  ereignisse = [];
  tonStuecke = [];
  setzen({
    stand: "fertig",
    aufnahme: { bildschirm, ton: ton && ton.size >= 1000 ? ton : null, ablauf: ablauf.slice(0, 500), sekunden },
  });
}

/** Aufnahme verwerfen (auch eine laufende). */
export function aufnahmeVerwerfen(): void {
  if (rec && rec.state !== "inactive") { try { rec.stop(); } catch { /* egal */ } }
  rec = null;
  aufraeumen();
  ereignisse = [];
  tonStuecke = [];
  ablauf = [];
  entwurf = null;
  setzen({ stand: "aus" });
}

/** Kann dieser Browser überhaupt aufnehmen? (Mikrofon + MediaRecorder) */
export function aufnahmeMoeglich(): boolean {
  return typeof window !== "undefined"
    && typeof MediaRecorder !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia;
}
