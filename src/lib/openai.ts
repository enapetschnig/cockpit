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

// ── Werbeanzeigen-Texte (Meta Ads) ───────────────────────────────────────
export interface AdCopyInput {
  goal: string; // leads | jobs | appointments | traffic
  offer: string;
  region: string;
  benefit?: string;
  destination?: string; // lead_form | website
  formStyle?: string; // simple | qualified | callback
}
export interface AdCopy {
  headline: string;
  primaryText: string;
  creativeNote: string; // Bild-/Video-Idee
  questions: string[];
}

/** Deterministische Vorlage (kein KI-Key nötig) – portiert aus der bestehenden Ads-App. */
export function templateAdCopy(input: AdCopyInput): AdCopy {
  const region = input.region || "Ihrer Region";
  const offer = input.offer || "unser Angebot";
  const benefitLine = input.benefit ? `${input.benefit}. ` : "";
  const cta = input.goal === "jobs" ? "Jetzt bewerben" : "Jetzt anfragen";
  const isPv = ["pv", "photovoltaik", "solar", "solaranlage"].some((t) => offer.toLowerCase().includes(t));

  let headline: string;
  let questions: string[];
  if (input.goal === "jobs") {
    headline = "Jetzt im Team bewerben";
    questions = ["Name", "Telefonnummer", "Ort", "Was machst du beruflich?"];
  } else {
    headline = "Kostenlose Anfrage in Ihrer Nähe";
    questions = ["Name", "Telefonnummer", "Ort", "Worum geht es?"];
  }
  if (input.formStyle === "qualified") questions = [...questions, "Wunschtermin", "Budgetrahmen"];
  else if (input.formStyle === "callback") questions = ["Name", "Telefonnummer", "Ort", "Beste Rückrufzeit"];

  let primaryText: string;
  let creativeNote: string;
  if (isPv) {
    headline = "PV-Anlage einfach prüfen lassen";
    questions = ["Name", "Telefonnummer", "Ort", "Dachart", "ungefähre Stromkosten"];
    primaryText =
      `Sie denken über eine PV-Anlage in ${region} nach? ${benefitLine}` +
      `Wir prüfen, welche Lösung zu Haus, Dach und Verbrauch passt. ` +
      `Klicken Sie auf „${cta}" und wir melden uns mit einer einfachen Ersteinschätzung.`;
    creativeNote =
      "Dreh ein kurzes Video direkt vor einem Hausdach, Wechselrichter oder Speicher. " +
      'Starte mit: „Sie überlegen, ob sich eine PV-Anlage bei Ihnen lohnt?" Kein Fachjargon.';
  } else {
    primaryText =
      `Sie suchen eine einfache Lösung für ${offer} in ${region}? ${benefitLine}` +
      `Wir helfen Ihnen schnell und unkompliziert weiter. ` +
      `Klicken Sie auf „${cta}" und wir melden uns mit den nächsten Schritten.`;
    creativeNote =
      "Kurzes, ehrliches Handy-Video vom Inhaber oder ein klares Vorher/Nachher-Bild. " +
      "Erste 3 Sekunden: das Problem des Kunden direkt ansprechen.";
  }
  return { headline, primaryText, creativeNote, questions };
}

/** KI-Variante (OpenAI). Fällt ohne Key/bei Fehler auf templateAdCopy zurück. */
export async function draftAdCopy(input: AdCopyInput): Promise<AdCopy> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) return templateAdCopy(input);
  const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";
  try {
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Du textest lokale Meta-Werbeanzeigen (Facebook/Instagram) für österreichische Handwerks-/Dienstleistungsbetriebe. " +
            "Ziel: einfache, vertrauensvolle Anzeigen, die Anfragen/Leads in der Region bringen – Du-frei, klares Hochdeutsch, kein Marketing-Blabla, keine Emojis, keine Übertreibung. " +
            'Gib NUR JSON zurück: { "headline": string (max 40 Zeichen), "primaryText": string (2-4 Sätze, endet mit Handlungsaufforderung), "creativeNote": string (konkrete Bild-/Video-Idee zum Selberdrehen), "questions": string[] (3-5 kurze Formularfragen, immer Name + Telefonnummer + Ort enthalten) }.',
        },
        {
          role: "user",
          content: [
            `Ziel: ${input.goal}`,
            `Angebot/Leistung: ${input.offer}`,
            `Region: ${input.region}`,
            input.benefit ? `Vorteil: ${input.benefit}` : "",
            `Ziel der Anzeige: ${input.destination === "website" ? "Klicks auf Website" : "Anfragen über Lead-Formular"}`,
            "Schreibe Headline, Primärtext, eine Creative-Idee und die Formularfragen.",
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
