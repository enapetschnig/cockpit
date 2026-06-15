/**
 * KI-Assistent für den Telegram-Bot: beantwortet Fragen zum Posteingang
 * (über Tools auf die DB) und kann Antwort-Entwürfe vorbereiten.
 */
import OpenAI from "openai";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getConfig } from "./config";
import { draftEmailReply } from "./openai";

export interface AssistantResult {
  reply: string;
  draftedFor?: { emailId: string; text: string; fromName: string };
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_emails",
      description:
        "Sucht/zählt eingegangene E-Mails. Beispiele: heutige Mails (since_days:0), offene Rechnungen (label:'buchhaltung'), Mails von jemandem (query:'Name').",
      parameters: {
        type: "object",
        properties: {
          since_days: { type: "number", description: "nur Mails der letzten N Tage; 0 = heute" },
          account: { type: "string", enum: ["firma", "privat"] },
          only_firmenrelevant: { type: "boolean" },
          label: { type: "string", description: "buchhaltung | angebot | aufgabe | support | termin | newsletter | privat" },
          query: { type: "string", description: "Freitext in Absender/Betreff/Zusammenfassung" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_customers",
      description: "Listet Kunden mit Anzahl offener Aufgaben und zugeordneter Mails.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_reply",
      description: "Erstellt einen Antwort-Entwurf auf eine bestimmte E-Mail (Nutzer bestätigt das Senden selbst).",
      parameters: {
        type: "object",
        properties: {
          email_id: { type: "string", description: "ID der E-Mail (aus search_emails)" },
          instruction: { type: "string", description: "Inhalt/Tonfall der Antwort" },
        },
        required: ["email_id", "instruction"],
      },
    },
  },
];

interface SearchArgs {
  since_days?: number;
  account?: string;
  only_firmenrelevant?: boolean;
  label?: string;
  query?: string;
  limit?: number;
}

async function searchEmails(a: SearchArgs) {
  const where: Prisma.EmailWhereInput = { outgoing: false };
  if (a.account === "firma" || a.account === "privat") where.account = a.account;
  if (a.only_firmenrelevant) where.firmenrelevant = true;
  if (typeof a.since_days === "number") {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(0, a.since_days));
    d.setHours(0, 0, 0, 0);
    where.receivedAt = { gte: d };
  }
  if (a.query) {
    where.OR = [
      { fromName: { contains: a.query, mode: "insensitive" } },
      { fromAddr: { contains: a.query, mode: "insensitive" } },
      { subject: { contains: a.query, mode: "insensitive" } },
      { summary: { contains: a.query, mode: "insensitive" } },
    ];
  }
  if (a.label) where.labelsJson = { contains: `"${a.label}"` };

  const rows = await prisma.email.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: Math.min(a.limit ?? 15, 30),
    include: { customer: true },
  });
  return {
    count: rows.length,
    emails: rows.map((e) => ({
      id: e.id,
      account: e.account,
      from: e.fromName,
      subject: e.subject,
      summary: e.summary,
      firmenrelevant: e.firmenrelevant,
      date: e.receivedAt.toISOString().slice(0, 16).replace("T", " "),
      customer: e.customer?.name ?? null,
    })),
  };
}

async function listCustomers() {
  const cs = await prisma.customer.findMany({ include: { todos: true, emails: true }, orderBy: { name: "asc" } });
  return {
    customers: cs.map((c) => ({ name: c.name, offeneAufgaben: c.todos.filter((t) => !t.done).length, mails: c.emails.length })),
  };
}

async function doDraft(emailId: string, instruction: string): Promise<{ result: unknown; drafted?: AssistantResult["draftedFor"] }> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return { result: { error: "E-Mail nicht gefunden" } };
  const text = await draftEmailReply({
    fromName: email.fromName,
    fromAddr: email.fromAddr,
    subject: email.subject,
    body: email.body,
    instruction,
  });
  return { result: { ok: true }, drafted: { emailId, text, fromName: email.fromName } };
}

export async function runAssistant(userText: string, context?: { replyEmailId?: string }): Promise<AssistantResult> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) return { reply: "OpenAI-Key fehlt – ich kann gerade nicht antworten." };
  const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  let drafted: AssistantResult["draftedFor"];
  const today = new Date().toISOString().slice(0, 10);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "Du bist der persönliche Assistent für das ePower Cockpit (E-Mail-Cockpit der ePower GmbH, Software für Handwerker). " +
        "Beantworte Fragen zum Posteingang knapp und konkret auf Deutsch – für Telegram. " +
        "Verwende KEIN Markdown (kein Sternchen-Fett, keine Raute-Überschriften, keine Tabellen) – nur einfachen Text, Emojis und Aufzählungen mit Bullet-Punkten. " +
        "Nutze IMMER die Tools für echte Daten und erfinde nichts. Du kannst Antwort-Entwürfe erstellen (draft_reply); " +
        `der Nutzer bestätigt das Senden selbst. Heute ist ${today}.`,
    },
    ...(context?.replyEmailId
      ? [
          {
            role: "system" as const,
            content: `Kontext: Der Nutzer antwortet auf die E-Mail mit id=${context.replyEmailId}. Wenn er eine Antwort formulieren möchte, rufe draft_reply mit dieser id auf.`,
          },
        ]
      : []),
    { role: "user", content: userText },
  ];

  for (let i = 0; i < 4; i++) {
    const resp = await client.chat.completions.create({ model, temperature: 0.2, messages, tools: TOOLS });
    const m = resp.choices[0]?.message;
    if (!m) break;
    messages.push(m);
    if (!m.tool_calls?.length) return { reply: (m.content ?? "").trim() || "…", draftedFor: drafted };

    for (const tc of m.tool_calls) {
      let result: unknown;
      try {
        const args = JSON.parse(tc.function.arguments || "{}");
        if (tc.function.name === "search_emails") result = await searchEmails(args as SearchArgs);
        else if (tc.function.name === "list_customers") result = await listCustomers();
        else if (tc.function.name === "draft_reply") {
          const r = await doDraft(String(args.email_id), String(args.instruction || ""));
          drafted = r.drafted ?? drafted;
          result = r.result;
        } else result = { error: "unbekanntes Tool" };
      } catch (e) {
        result = { error: (e as Error).message };
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return { reply: drafted ? "" : "Das habe ich nicht ganz verstanden – formulier es bitte anders.", draftedFor: drafted };
}
