import OpenAI from "openai";
import type { ClassifyResult, Priority } from "./types";
import { ALL_LABEL_KEYS } from "./labels";
import { getConfig } from "./config";

interface MailInput {
  account: string;
  fromName: string;
  fromAddr: string;
  subject: string;
  body: string;
}

const SYSTEM_PROMPT =
  "Du bist ein Assistent, der eingehende E-Mails für die österreichische Firma ePower GmbH einordnet. " +
  "Die Firma entwickelt individuelle Software für Handwerker. Antworte AUSSCHLIESSLICH mit gültigem JSON.";

function buildUserPrompt(m: MailInput, today: string): string {
  return [
    `Konto: ${m.account}`,
    `Von: ${m.fromName} <${m.fromAddr}>`,
    `Betreff: ${m.subject}`,
    "",
    m.body,
    "",
    `Heute ist ${today} (Wiener Zeit).`,
    "Gib JSON mit genau diesen Feldern zurück:",
    '- "summary": ein deutscher Satz, max. 20 Wörter',
    `- "labels": Teilmenge aus ${JSON.stringify(ALL_LABEL_KEYS)}`,
    '- "firmenrelevant": true/false – WICHTIG: auch true, wenn die Mail im Privat-Postfach',
    "  ankommt, aber die Firma betrifft (z. B. Steuerberater, Lieferanten-/Server-Rechnung).",
    '- "priority": "hi" | "mid" | "lo"',
    '- "suggestedTodos": kurze deutsche Aufgaben (Array), leer wenn nichts zu tun ist',
    '- "proposedEvent": {"title","start","end"} mit start/end als "YYYY-MM-DDTHH:MM:SS" – NUR wenn die Mail',
    "  einen konkreten Termin/Besuch mit Datum UND Uhrzeit vorschlägt (relative Angaben wie 'Donnerstag' aus dem heutigen Datum berechnen); sonst null.",
  ].join("\n");
}

export async function classifyEmail(m: MailInput): Promise<ClassifyResult> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) return heuristic(m);
  const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";
  const today = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  try {
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(m, today) },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    return normalize(JSON.parse(raw), m);
  } catch (e) {
    console.error("[openai] Klassifizierung fehlgeschlagen – nutze Regel-Fallback:", e);
    return heuristic(m);
  }
}

function normalize(j: Record<string, unknown>, m: MailInput): ClassifyResult {
  const labels = Array.isArray(j.labels)
    ? (j.labels as unknown[]).map(String).filter((l) => ALL_LABEL_KEYS.includes(l))
    : [];
  const priority = (["hi", "mid", "lo"].includes(j.priority as string) ? j.priority : "mid") as Priority;
  const todos = Array.isArray(j.suggestedTodos)
    ? (j.suggestedTodos as unknown[]).map(String).filter(Boolean)
    : [];
  let proposedEvent: ClassifyResult["proposedEvent"] = null;
  if (j.proposedEvent && typeof j.proposedEvent === "object") {
    const o = j.proposedEvent as Record<string, unknown>;
    if (typeof o.start === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(o.start)) {
      proposedEvent = {
        title: typeof o.title === "string" && o.title.trim() ? o.title.trim() : m.subject,
        start: o.start,
        end: typeof o.end === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(o.end) ? o.end : o.start,
      };
    }
  }
  return {
    summary: typeof j.summary === "string" && j.summary.trim() ? j.summary.trim() : fallbackSummary(m),
    labels,
    firmenrelevant: typeof j.firmenrelevant === "boolean" ? j.firmenrelevant : labels.length > 0,
    priority,
    suggestedTodos: todos,
    proposedEvent,
  };
}

function fallbackSummary(m: MailInput): string {
  const t = m.body.replace(/\s+/g, " ").trim();
  return t.length > 120 ? t.slice(0, 117) + "…" : t || m.subject;
}

/**
 * Einfacher Regel-Fallback, damit die App auch OHNE OpenAI-Key sinnvoll läuft.
 */
function heuristic(m: MailInput): ClassifyResult {
  const text = `${m.subject} ${m.body} ${m.fromAddr}`.toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => text.includes(k));
  const labels = new Set<string>();
  let priority: Priority = "mid";
  let firmenrelevant = m.account === "firma";

  if (has("rechnung", "beleg", "betrag", "zahlung", "€", "steuerberat", "faktura", "invoice")) {
    labels.add("buchhaltung");
    firmenrelevant = true;
  }
  if (has("angebot", "offerte", "kostenvoranschlag", "interesse", "anfrage")) {
    labels.add("angebot");
    labels.add("aufgabe");
    firmenrelevant = true;
  }
  if (has("bug", "fehler", "stürzt", "absturz", "funktioniert nicht", "support", "problem")) {
    labels.add("support");
    labels.add("aufgabe");
    priority = "hi";
    firmenrelevant = true;
  }
  if (has("termin", "vorbeikommen", "meeting", "wann passt", "kalender")) labels.add("termin");
  if (has("newsletter", "abmelden", "unsubscribe", "weekly")) {
    labels.add("newsletter");
    firmenrelevant = false;
    priority = "lo";
  }
  if (has("dringend", "sofort", "asap", "bis freitag", "bis morgen", "stürzt")) priority = "hi";

  // Privat erkannt (persönliche Absender, keine Firmen-Signale)
  if (!firmenrelevant && labels.size === 0) {
    labels.add("privat");
    priority = "lo";
  }

  const suggestedTodos: string[] = [];
  if (labels.has("angebot")) suggestedTodos.push("Angebot vorbereiten");
  if (labels.has("support")) suggestedTodos.push("Problem prüfen & zurückmelden");
  if (labels.has("buchhaltung")) suggestedTodos.push("Beleg für die Buchhaltung ablegen");

  return { summary: fallbackSummary(m), labels: [...labels], firmenrelevant, priority, suggestedTodos };
}

/** Transkribiert eine Sprachnachricht (OGG/Opus von Telegram) per Whisper. */
export async function transcribeVoice(audio: Buffer, mime = "audio/ogg"): Promise<string> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OpenAI-Key fehlt für die Transkription.");
  const client = new OpenAI({ apiKey });
  const file = new File([new Uint8Array(audio)], "voice.ogg", { type: mime });
  const tr = await client.audio.transcriptions.create({ file, model: "whisper-1", language: "de" });
  return (tr.text || "").trim();
}

/** Erstellt einen professionellen deutschen E-Mail-Antworttext aus Original + Anweisung. */
export async function draftEmailReply(input: {
  fromName: string;
  fromAddr: string;
  subject: string;
  body: string;
  instruction: string;
  context?: string;
}): Promise<string> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OpenAI-Key fehlt.");
  const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          "Du formulierst professionelle, freundliche deutsche E-Mail-Antworten für die ePower GmbH (Software für Handwerker). " +
          "Gib NUR den Antworttext aus – keine Betreffzeile, keine Anführungszeichen, keine Erklärungen. Höflich, knapp, mit passender Anrede und Grußformel." +
          (input.context ? "\n\nBerücksichtige diesen Kontext (Mail-Verlauf + Wissen über Nutzer/Kunde), damit die Antwort genau passt:\n" + input.context : ""),
      },
      {
        role: "user",
        content:
          `Ursprüngliche Mail von ${input.fromName} <${input.fromAddr}>\nBetreff: ${input.subject}\n\n${input.body}\n\n` +
          `---\nMeine Anweisung für die Antwort: ${input.instruction}\n\nSchreibe die Antwort-E-Mail.`,
      },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() || "";
}

/** Verfasst eine komplett neue deutsche E-Mail (Betreff + Text) aus einem Auftrag. */
export async function composeEmail(input: { to: string; instruction: string; context?: string }): Promise<{ subject: string; body: string }> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OpenAI-Key fehlt.");
  const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Du schreibst professionelle, freundliche deutsche E-Mails für die ePower GmbH (Software für Handwerker). " +
          'Gib NUR JSON zurück: { "subject": "...", "body": "..." }. Der Body hat passende Anrede und Grußformel, kein Markdown, keine Platzhalter wie [Name].' +
          (input.context ? "\n\nBerücksichtige dieses Wissen über Nutzer/Kunde:\n" + input.context : ""),
      },
      { role: "user", content: `Empfänger: ${input.to}\nAuftrag: ${input.instruction}\n\nSchreibe Betreff und Mailtext.` },
    ],
  });
  const j = JSON.parse(resp.choices[0]?.message?.content ?? "{}") as { subject?: string; body?: string };
  return { subject: (j.subject || "Nachricht").trim(), body: (j.body || "").trim() };
}

// ── Werbeanzeigen-Texte (Meta Ads) – nach den Local-Ads-Guidelines ────────
export interface AdCopyInput {
  goal: string; // leads | jobs | appointments | traffic
  offer: string;
  region: string; // freie Region/Stadt-Angabe (Anzeigentext)
  city?: string; // konkreter Ort für die lokale Direktansprache (sonst aus region abgeleitet)
  benefit?: string;
  destination?: string; // lead_form | website
  formStyle?: string; // simple | qualified | callback
  tone?: string; // "du" (Standard, nahbar) | "sie" (konservativ/B2B)
  styleSample?: string; // optionaler eigener Beispieltext (Brand Voice)
}
export interface AdCopy {
  headline: string;
  primaryText: string;
  creativeNote: string; // Video-Skript / Bild-Idee
  questions: string[];
}

const CTA_BY_GOAL: Record<string, string> = {
  leads: "Anfrage senden",
  jobs: "Jetzt bewerben",
  appointments: "Termin anfragen",
  traffic: "Mehr erfahren",
};

function cityFromInput(input: AdCopyInput): string {
  if (input.city?.trim()) return input.city.trim();
  // Erstes Wort der Region als grober Ort (z. B. "Klagenfurt und 30 km Umgebung" → "Klagenfurt")
  const m = (input.region || "").trim().match(/^[\p{L}.\-]+/u);
  return m ? m[0] : input.region || "deiner Region";
}

/** Die hochgeladenen Local-Ads-Guidelines als System-Prompt (PAS+CTA, lokale Ansprache, Du/Sie). */
function adSystemPrompt(tone: string): string {
  const du = tone !== "sie";
  const anrede = du ? `Duze die Leser (per "du"), nahbar und auf Augenhöhe` : `Sieze die Leser (per "Sie"), seriös aber persönlich`;
  return [
    `Du bist Texter für LOKALE Meta-Werbeanzeigen (Facebook/Instagram Newsfeed) von regionalen Handwerks-/Dienstleistungsbetrieben in Österreich.`,
    `Schreibe nach diesem bewährten Local-Ads-Framework:`,
    `1) LOKALE DIREKTANSPRACHE ist Pflicht – in der Headline (Ort + Zielgruppe + Benefit) UND als allererste Zeile des Textes, z. B. "An alle [Zielgruppe] in [STADT] und Umgebung:".`,
    `2) Struktur des Textes: PROBLEM (rhetorische Frage, die abholt) -> AGITATION (Schmerzpunkt verschärfen, gern mit "..., oder?") -> LÖSUNG (der Betrieb als einfache, lokale Lösung, kurzes Trust-Element/Referenzen vor Ort) -> KLARER CTA mit Erklärung des nächsten Schritts (z. B. "Klick auf den Button, hinterlass deine Nummer – wir melden uns kostenlos und unverbindlich").`,
    `3) Optional am Ende ECHTE Verknappung (nur wenn glaubwürdig: "Nur noch 2 Plätze frei"). Persönliche Grußformel erlaubt.`,
    `4) Tonalität: persönlich, gesprochen, Ich-/Wir-Form, kurze Absätze bzw. Ein-Satz-Zeilen, kein Fachjargon, kein Marketing-Blabla, nahbar statt hochglanz. ${anrede}.`,
    `5) VERBOTEN: niemals andeuten, WARUM jemand die Anzeige sieht ("du siehst das, weil du aus ... bist"); kein Fachjargon; bei Photovoltaik NICHT das Thema Energiegemeinschaften ansprechen; kein Text im Werbebild.`,
    `6) Bei Photovoltaik/Solar: Headline im Stil "PV-Anlage einfach prüfen lassen", Fokus auf einfache kostenlose Ersteinschätzung, Fragen inkl. Dachart und ungefähre Stromkosten.`,
    `7) creativeNote = konkretes Video-Skript zum Selberdrehen (60–90 Sek, One-Take), mit Timing: 0–3s lokaler Hook vor lokalem Hintergrund, 3–10s Ergebnis/Arbeit zeigen, 10–17s Vorteil, 17–22s klarer CTA.`,
    `8) questions = 2–4 kurze Lead-Formularfragen, IMMER mit Name, Telefonnummer und Ort; je nach Ziel ergänzen (Jobs: Berufserfahrung + Startzeitpunkt; Termine: Wunschtermin; PV: Dachart + Stromkosten).`,
    `Gib NUR gültiges JSON zurück: { "headline": string (kurz, mit Ort+Zielgruppe), "primaryText": string (mehrere kurze Zeilen, lokale Ansprache zuerst, endet mit CTA), "creativeNote": string (Video-Skript mit Timing), "questions": string[] }.`,
  ].join("\n");
}

/** Deterministische Vorlage (kein KI-Key nötig) – an die Guidelines angelehnt, mit lokaler Ansprache. */
export function templateAdCopy(input: AdCopyInput): AdCopy {
  const du = input.tone !== "sie";
  const city = cityFromInput(input);
  const offer = input.offer || (du ? "unser Angebot" : "unser Angebot");
  const cta = CTA_BY_GOAL[input.goal] || "Anfrage senden";
  const benefitLine = input.benefit ? `${input.benefit}. ` : "";
  const isPv = ["pv", "photovoltaik", "solar", "solaranlage"].some((t) => offer.toLowerCase().includes(t));
  const youHave = du ? "Du suchst" : "Sie suchen";
  const yourClick = du ? "Klick" : "Klicken Sie";
  const weCall = du ? "wir melden uns" : "wir melden uns";

  let headline: string;
  let questions: string[];
  if (input.goal === "jobs") {
    headline = `Für ${city}er: Jetzt im Team bewerben`;
    questions = ["Name", "Telefonnummer", "Ort", "Berufserfahrung", "Wann können Sie starten?"];
  } else {
    headline = `Für ${city} & Umgebung: ${offer}`;
    questions = ["Name", "Telefonnummer", "Ort", "Worum geht es?"];
  }
  if (input.formStyle === "qualified") questions = [...questions, "Wann möchten Sie starten?"];
  else if (input.formStyle === "callback") questions = ["Name", "Telefonnummer", "Ort", "Beste Rückrufzeit"];

  let primaryText: string;
  let creativeNote: string;
  if (isPv) {
    headline = `PV in ${city}? Einfach prüfen lassen`;
    questions = ["Name", "Telefonnummer", "Ort", "Dachart", "ungefähre Stromkosten"];
    primaryText =
      `An alle Hausbesitzer in ${city} & Umgebung:\n\n` +
      `${du ? "Denkst du" : "Denken Sie"} über eine PV-Anlage nach, ${du ? "weißt aber nicht" : "wissen aber nicht"}, ob sie sich beim eigenen Dach wirklich lohnt? ${benefitLine}\n` +
      `Wir prüfen, welche Lösung zu Haus, Dach und Verbrauch passt – einfach und verständlich.\n\n` +
      `${yourClick} unten auf „${cta}" und ${weCall} mit einer kostenlosen Ersteinschätzung.`;
    creativeNote =
      `Kurzes Handy-Video (60–90 Sek) direkt vor einem Hausdach in ${city}. ` +
      `0–3s: „${du ? "Du überlegst" : "Sie überlegen"}, ob sich eine PV-Anlage bei dir lohnt?". 3–10s Dach/Speicher zeigen, 10–17s Vorteil, 17–22s CTA. Kein Fachjargon, kein Thema Energiegemeinschaften.`;
  } else {
    primaryText =
      `An alle in ${city} & Umgebung:\n\n` +
      `${youHave} ${offer}? ${benefitLine}\n` +
      `Wir helfen ${du ? "dir" : "Ihnen"} schnell und unkompliziert weiter – vom Betrieb direkt aus der Region.\n\n` +
      `${yourClick} unten auf „${cta}" und ${weCall} mit den nächsten Schritten.`;
    creativeNote =
      `Ehrliches Handy-Video vom Inhaber vor einem lokalen Hintergrund in ${city} (oder klares Vorher/Nachher). ` +
      `0–3s lokaler Hook („${city}, aufgepasst!"), 3–10s Arbeit/Ergebnis zeigen, 10–17s Vorteil, 17–22s CTA.`;
  }
  return { headline, primaryText, creativeNote, questions };
}

/** KI-Variante (OpenAI, nach den Guidelines). Fällt ohne Key/bei Fehler auf templateAdCopy zurück. */
export async function draftAdCopy(input: AdCopyInput): Promise<AdCopy> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) return templateAdCopy(input);
  const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";
  try {
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: adSystemPrompt(input.tone || "du") },
        {
          role: "user",
          content: [
            `Ziel der Kampagne: ${input.goal}`,
            `Angebot/Leistung: ${input.offer}`,
            `Ort für die lokale Ansprache: ${cityFromInput(input)}`,
            `Region (Anzeigentext): ${input.region}`,
            input.benefit ? `Vorteil/USP: ${input.benefit}` : "",
            `Anzeigenziel: ${input.destination === "website" ? "Klicks auf Website" : "Anfragen über Lead-Sofortformular"}`,
            `CTA-Button: ${CTA_BY_GOAL[input.goal] || "Anfrage senden"}`,
            input.styleSample ? `Orientiere dich am Stil dieses Beispieltextes:\n"""${input.styleSample}"""` : "",
            "Schreibe Headline, Anzeigentext (lokale Ansprache zuerst, PAS+CTA), ein Video-Skript und die Formularfragen.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    const j = JSON.parse(resp.choices[0]?.message?.content ?? "{}") as Partial<AdCopy>;
    const tmpl = templateAdCopy(input);
    const questions = Array.isArray(j.questions) && j.questions.length ? j.questions.map(String).filter(Boolean) : tmpl.questions;
    return {
      headline: (j.headline || tmpl.headline).trim(),
      primaryText: (j.primaryText || tmpl.primaryText).trim(),
      creativeNote: (j.creativeNote || tmpl.creativeNote).trim(),
      questions,
    };
  } catch (e) {
    console.error("[openai] Ad-Text fehlgeschlagen – nutze Vorlage:", e);
    return templateAdCopy(input);
  }
}
