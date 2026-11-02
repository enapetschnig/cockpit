/**
 * Abschrift für „Änderung melden" im Cockpit (02.11.2026) – Gegenstück zu `sprache-zu-text` der Handwerker-Apps
 * (Vorlage: steinbrecher/supabase/functions/sprache-zu-text, dort die Herleitung).
 *
 * { wunschId } → holt die Sprachnachricht des Wunsches aus `cockpit-wuensche`, schreibt sie ab und hängt den Text an
 * crm.app_wuensche.text an. Mit Bildschirmaufnahme (aufnahme_ablauf gesetzt): Abschrift mit Zeitmarken (whisper-1),
 * Gesagtes und Gezeigtes als Zeitleiste, gpt-4.1-mini macht daraus die einzelnen Wünsche.
 *
 * Nur der Inhaber (crm.ist_inhaber() mit seinem eigenen Login), nur Wünsche mit app_key 'cockpit'.
 * Scheitert etwas, steht der Grund am Wunsch – die Meldung selbst bleibt.
 */
import { createClient } from "npm:@supabase/supabase-js@2.89.0";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BEREICH = "cockpit-wuensche";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const antwort = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, "Content-Type": "application/json" } });

/** Wortschatz des Cockpits – sonst macht die Abschrift aus Fachwörtern Kauderwelsch. */
const FACHWOERTER = [
  "Cockpit", "CRM", "Lead", "Angebot", "Rechnung", "Schlussrechnung", "Anzahlungsrechnung", "Mahnwesen", "Kassabuch",
  "Buchhaltung", "BMD", "Export", "Wartungsvertrag", "Änderungswunsch", "Roboter", "Supabase", "Vercel", "Telegram",
  "Handwerker-App", "Kennzahlen", "Auftragsvolumen", "Besprechung", "Plaud",
].join(", ");

const STILLE_FLOSKELN =
  /untertitel|amara\.org|vielen dank (fürs|für's|für das) zu(schauen|sehen|hören)|bis zum nächsten mal|swr \d{4}|copyright/i;

interface Satz { t: number; text: string }
interface Schritt { t: number; art: "seite" | "klick"; text: string }

const endung = (mime: string) => {
  const m = mime.split(";")[0].trim().toLowerCase();
  return m.includes("mp4") || m.includes("m4a") ? "mp4" : m.includes("ogg") ? "ogg" : m.includes("mpeg") || m.includes("mp3") ? "mp3" : m.includes("wav") ? "wav" : "webm";
};
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

async function abschreiben(datei: Blob, mime: string, mitZeiten: boolean): Promise<{ text: string; saetze: Satz[] }> {
  const form = new FormData();
  form.append("model", mitZeiten ? "whisper-1" : "gpt-4o-transcribe");
  if (mitZeiten) {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  }
  form.append("file", datei, `aufnahme.${endung(mime)}`);
  form.append("language", "de");
  form.append("prompt", "Sprachnotiz von Christoph (ePower GmbH) zu einem Änderungswunsch an seinem Cockpit/CRM. "
    + `Hochdeutsch mit österreichischem Einschlag – sauber abschreiben, Füllwörter weglassen. Fachbegriffe: ${FACHWOERTER}`);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form,
  });
  if (!res.ok) throw new Error(`Abschrift fehlgeschlagen (${res.status})`);
  const json = await res.json();
  if (!mitZeiten || !Array.isArray(json.segments)) return { text: String(json.text ?? "").trim(), saetze: [] };
  // whisper-1 erfindet bei Stille gern Sätze – weg damit.
  const saetze: Satz[] = json.segments
    .filter((g: { no_speech_prob?: number; avg_logprob?: number }) => !((g.no_speech_prob ?? 0) > 0.6 && (g.avg_logprob ?? 0) < -0.5))
    .map((g: { start?: number; text?: string }) => ({ t: Number(g.start) || 0, text: String(g.text ?? "").trim() }))
    .filter((g: Satz) => g.text && !STILLE_FLOSKELN.test(g.text));
  return { text: saetze.map((g) => g.text).join(" "), saetze };
}

function zeitleiste(saetze: Satz[], schritte: Schritt[]): string {
  return [
    ...schritte.map((s) => ({ t: Number(s.t) || 0, z: s.art === "seite" ? `Seite ${String(s.text).slice(0, 200)}` : `tippt ${String(s.text).slice(0, 100)}` })),
    ...saetze.map((s) => ({ t: s.t, z: `sagt: „${s.text}"` })),
  ].sort((a, b) => a.t - b.t).map((x) => `[${mmss(x.t)}] ${x.z}`).join("\n");
}

async function wuenscheAusVorfuehrung(leiste: string): Promise<string> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: "gpt-4.1-mini", temperature: 0, max_tokens: 1500,
        messages: [
          { role: "system", content:
            "Christoph hat in seinem Cockpit (CRM/Buchhaltung der ePower GmbH) vorgeführt, was er geändert haben will, und " +
            "dabei geredet. Du bekommst die Zeitleiste (Seite = wo er war, tippt = was er angetippt hat, sagt = Abschrift). " +
            "Schreib daraus die einzelnen Änderungswünsche als nummerierte Liste, je Wunsch EIN klarer Satz, in seinen Worten, " +
            "und in Klammern die Seite bzw. das Element, um das es geht. Nichts dazuerfinden. Fragen als Frage aufnehmen. " +
            "Nur die Liste ausgeben, ohne Einleitung, ohne Markdown. Ist kein Wunsch zu erkennen, nur „–\"." },
          { role: "user", content: leiste.slice(0, 30_000) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const liste = String((await res.json())?.choices?.[0]?.message?.content ?? "").trim();
    return liste && liste !== "–" ? liste : "";
  } catch (f) {
    console.error("wunsch-abschrift: Wünsche nicht ausgewertet:", f instanceof Error ? f.message : f);
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const dienst = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }, db: { schema: "crm" } });
  let wunschId = "";
  /** Fehler an den Wunsch hängen – der getippte Text bleibt. */
  const anhaengen = async (zusatz: string) => {
    const { data } = await dienst.from("app_wuensche").select("text").eq("id", wunschId).eq("app_key", "cockpit").maybeSingle();
    const alt = String(data?.text ?? "").trim();
    await dienst.from("app_wuensche").update({ text: alt ? `${alt}\n\n${zusatz}` : zusatz, aktualisiert: new Date().toISOString() })
      .eq("id", wunschId).eq("app_key", "cockpit");
  };
  try {
    const nutzer = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false }, db: { schema: "crm" },
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: inhaber } = await nutzer.rpc("ist_inhaber");
    if (inhaber !== true) return antwort({ success: false, error: "kein Zugriff" });
    const body = await req.json().catch(() => ({}));
    if (typeof body?.wunschId !== "string") return antwort({ success: false, error: "wunschId fehlt" });
    const { data: w } = await dienst.from("app_wuensche").select("id, audio_pfad, aufnahme_ablauf")
      .eq("id", body.wunschId).eq("app_key", "cockpit").maybeSingle();
    if (!w?.audio_pfad) return antwort({ success: false, error: "kein Ton am Wunsch" });
    wunschId = w.id;
    if (!OPENAI_API_KEY) throw new Error("Die Spracherkennung ist nicht eingerichtet.");

    const pfad = String(w.audio_pfad).replace(`${BEREICH}/`, "");
    const { data: datei, error } = await dienst.storage.from(BEREICH).download(pfad);
    if (error || !datei) throw new Error("Sprachnachricht nicht lesbar.");
    const mime = datei.type || "audio/webm";

    const ablauf = w.aufnahme_ablauf && typeof w.aufnahme_ablauf === "object" ? w.aufnahme_ablauf as { sekunden?: number; schritte?: Schritt[] } : null;
    let text: string;
    if (ablauf) {
      let saetze: Satz[] = [];
      try {
        const r = await abschreiben(datei, mime, true);
        text = r.text;
        saetze = r.saetze.length ? r.saetze : (r.text ? [{ t: 0, text: r.text }] : []);
      } catch {
        text = (await abschreiben(datei, mime, false)).text;
        saetze = text ? [{ t: 0, text }] : [];
      }
      const leiste = zeitleiste(saetze, Array.isArray(ablauf.schritte) ? ablauf.schritte.slice(0, 500) : []);
      const liste = text ? await wuenscheAusVorfuehrung(leiste) : "";
      const dauer = mmss(Number(ablauf.sekunden) || 0);
      text = [
        liste ? `Gezeigt und erklärt (Bildschirmaufnahme ${dauer}):\n${liste}`
          : `Bildschirmaufnahme ${dauer}${text ? "" : " (gesprochen war nichts zu verstehen)"}`,
        `Ablauf${text ? " mit Abschrift" : ""}:\n${leiste || "–"}`,
      ].join("\n\n");
    } else {
      text = (await abschreiben(datei, mime, false)).text || "(In der Sprachnachricht war nichts zu verstehen.)";
    }
    await anhaengen(text);
    return antwort({ success: true });
  } catch (f) {
    const grund = f instanceof Error ? f.message : "Unbekannter Fehler";
    console.error("wunsch-abschrift:", grund);
    if (wunschId) await anhaengen(`(Abschrift nicht möglich: ${grund} – Ton im Cockpit anhören.)`).catch(() => {});
    return antwort({ success: false, error: grund });
  }
});
