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

function buildUserPrompt(m: MailInput): string {
  return [
    `Konto: ${m.account}`,
    `Von: ${m.fromName} <${m.fromAddr}>`,
    `Betreff: ${m.subject}`,
    "",
    m.body,
    "",
    "Gib JSON mit genau diesen Feldern zurück:",
    '- "summary": ein deutscher Satz, max. 20 Wörter',
    `- "labels": Teilmenge aus ${JSON.stringify(ALL_LABEL_KEYS)}`,
    '- "firmenrelevant": true/false – WICHTIG: auch true, wenn die Mail im Privat-Postfach',
    "  ankommt, aber die Firma betrifft (z. B. Steuerberater, Lieferanten-/Server-Rechnung).",
    '- "priority": "hi" | "mid" | "lo"',
    '- "suggestedTodos": kurze deutsche Aufgaben (Array), leer wenn nichts zu tun ist',
  ].join("\n");
}

export async function classifyEmail(m: MailInput): Promise<ClassifyResult> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) return heuristic(m);
  const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";

  try {
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(m) },
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
  return {
    summary: typeof j.summary === "string" && j.summary.trim() ? j.summary.trim() : fallbackSummary(m),
    labels,
    firmenrelevant: typeof j.firmenrelevant === "boolean" ? j.firmenrelevant : labels.length > 0,
    priority,
    suggestedTodos: todos,
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
          "Gib NUR den Antworttext aus – keine Betreffzeile, keine Anführungszeichen, keine Erklärungen. Höflich, knapp, mit passender Anrede und Grußformel.",
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
export async function composeEmail(input: { to: string; instruction: string }): Promise<{ subject: string; body: string }> {
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
          'Gib NUR JSON zurück: { "subject": "...", "body": "..." }. Der Body hat passende Anrede und Grußformel, kein Markdown, keine Platzhalter wie [Name].',
      },
      { role: "user", content: `Empfänger: ${input.to}\nAuftrag: ${input.instruction}\n\nSchreibe Betreff und Mailtext.` },
    ],
  });
  const j = JSON.parse(resp.choices[0]?.message?.content ?? "{}") as { subject?: string; body?: string };
  return { subject: (j.subject || "Nachricht").trim(), body: (j.body || "").trim() };
}
