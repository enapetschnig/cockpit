/**
 * KI-Assistent für den Telegram-Bot: beantwortet Fragen zum Posteingang UND handelt
 * (zuordnen, ablegen, Aufgaben anlegen, antworten). Mit Gesprächsgedächtnis (BotMessage).
 */
import OpenAI from "openai";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getConfig } from "./config";
import { draftEmailReply, composeEmail } from "./openai";
import { ASSISTANT_PERSONA } from "./persona";

export interface AssistantResult {
  reply: string;
  draftedFor?: { emailId: string; text: string; fromName: string; toAddr: string; fromEmail: string; account: string; subject: string };
  newEmail?: { pendingId: string; account: string; fromEmail: string; toAddr: string; toName?: string; subject: string; body: string };
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_emails",
      description:
        "Sucht/zählt eingegangene E-Mails. Bsp: heutige Mails (since_days:0), offene Rechnungen (label:'buchhaltung'), Mails von jemandem (query:'Name'). Liefert IDs für weitere Aktionen.",
      parameters: {
        type: "object",
        properties: {
          since_days: { type: "number", description: "nur Mails der letzten N Tage; 0 = heute" },
          account: { type: "string", enum: ["firma", "privat"] },
          only_firmenrelevant: { type: "boolean" },
          unassigned: { type: "boolean", description: "nur noch keinem Kunden zugeordnete" },
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
      name: "get_email",
      description: "Liefert den vollständigen Text einer E-Mail (für Zusammenfassungen/Details).",
      parameters: { type: "object", properties: { email_id: { type: "string" } }, required: ["email_id"] },
    },
  },
  {
    type: "function",
    function: { name: "list_customers", description: "Listet Kunden mit Anzahl offener Aufgaben und Mails.", parameters: { type: "object", properties: {} } },
  },
  {
    type: "function",
    function: { name: "list_open_todos", description: "Listet alle offenen Aufgaben (optional je Kunde).", parameters: { type: "object", properties: { customer_name: { type: "string" } } } },
  },
  {
    type: "function",
    function: {
      name: "assign_email_to_customer",
      description: "Ordnet eine E-Mail einem Kunden zu (legt den Kunden bei Bedarf neu an).",
      parameters: { type: "object", properties: { email_id: { type: "string" }, customer_name: { type: "string" } }, required: ["email_id", "customer_name"] },
    },
  },
  {
    type: "function",
    function: {
      name: "file_to_accounting",
      description: "Legt eine E-Mail in der Buchhaltung ab (markiert sie als abgelegt).",
      parameters: { type: "object", properties: { email_id: { type: "string" } }, required: ["email_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_todo",
      description: "Legt eine Aufgabe an, optional bei einem Kunden.",
      parameters: { type: "object", properties: { text: { type: "string" }, customer_name: { type: "string" } }, required: ["text"] },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_todo",
      description: "Hakt eine offene Aufgabe als erledigt ab (per Text/Stichwort finden).",
      parameters: { type: "object", properties: { todo_text: { type: "string" } }, required: ["todo_text"] },
    },
  },
  {
    type: "function",
    function: {
      name: "reopen_todo",
      description: "Öffnet eine bereits erledigte Aufgabe wieder.",
      parameters: { type: "object", properties: { todo_text: { type: "string" } }, required: ["todo_text"] },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Merkt sich dauerhaft eine wichtige Information (Vorliebe des Nutzers, Deadline, Kunden-Info, laufendes Thema), damit du es beim nächsten Mal weißt. Nutze das proaktiv.",
      parameters: { type: "object", properties: { content: { type: "string" }, topic: { type: "string", description: "optionale Kategorie, z. B. Kundenname oder 'Vorliebe'" } }, required: ["content"] },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_facts",
      description: "Durchsucht das Langzeit-Gedächtnis nach gemerkten Fakten.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_reply",
      description: "Bereitet eine Antwort auf eine E-Mail vor (der Nutzer bestätigt das Senden selbst per Knopf).",
      parameters: { type: "object", properties: { email_id: { type: "string" }, instruction: { type: "string" } }, required: ["email_id", "instruction"] },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_new_email",
      description:
        "Verfasst eine KOMPLETT NEUE E-Mail (kein Reply). Empfänger als E-Mail-Adresse (to) ODER Kundenname (customer_name, Adresse wird aus dessen letzter Mail genommen). Der Nutzer bestätigt das Senden per Knopf.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "E-Mail-Adresse des Empfängers" },
          customer_name: { type: "string", description: "alternativ: Kundenname" },
          account: { type: "string", enum: ["firma", "privat"], description: "von welchem Postfach gesendet wird (Standard firma)" },
          subject: { type: "string", description: "optionaler Betreff" },
          instruction: { type: "string", description: "Inhalt/Auftrag der Mail" },
        },
        required: ["instruction"],
      },
    },
  },
];

interface Args {
  since_days?: number;
  account?: string;
  only_firmenrelevant?: boolean;
  unassigned?: boolean;
  label?: string;
  query?: string;
  limit?: number;
  email_id?: string;
  customer_name?: string;
  text?: string;
  instruction?: string;
  content?: string;
  topic?: string;
  todo_text?: string;
  to?: string;
  subject?: string;
}

function parseLabels(s: string): string[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

async function findCustomer(name: string, createIfMissing = false) {
  let c = await prisma.customer.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (!c && createIfMissing) c = await prisma.customer.create({ data: { name, color: "#2f6df0" } });
  return c;
}

async function runTool(name: string, a: Args): Promise<unknown> {
  switch (name) {
    case "search_emails": {
      const where: Prisma.EmailWhereInput = { outgoing: false };
      if (a.account === "firma" || a.account === "privat") where.account = a.account;
      if (a.only_firmenrelevant) where.firmenrelevant = true;
      if (a.unassigned) where.customerId = null;
      if (typeof a.since_days === "number") {
        const d = new Date();
        d.setDate(d.getDate() - Math.max(0, a.since_days));
        d.setHours(0, 0, 0, 0);
        where.receivedAt = { gte: d };
      }
      if (a.query)
        where.OR = [
          { fromName: { contains: a.query, mode: "insensitive" } },
          { fromAddr: { contains: a.query, mode: "insensitive" } },
          { subject: { contains: a.query, mode: "insensitive" } },
          { summary: { contains: a.query, mode: "insensitive" } },
        ];
      if (a.label) where.labelsJson = { contains: `"${a.label}"` };
      const rows = await prisma.email.findMany({ where, orderBy: { receivedAt: "desc" }, take: Math.min(a.limit ?? 15, 30), include: { customer: true } });
      return {
        count: rows.length,
        emails: rows.map((e) => ({
          id: e.id,
          account: e.account,
          from: e.fromName,
          subject: e.subject,
          summary: e.summary,
          firmenrelevant: e.firmenrelevant,
          labels: parseLabels(e.labelsJson),
          date: e.receivedAt.toISOString().slice(0, 16).replace("T", " "),
          customer: e.customer?.name ?? null,
          filed: e.filed,
        })),
      };
    }
    case "get_email": {
      const e = a.email_id ? await prisma.email.findUnique({ where: { id: a.email_id }, include: { customer: true } }) : null;
      if (!e) return { error: "E-Mail nicht gefunden" };
      return {
        id: e.id,
        account: e.account,
        from: e.fromName,
        fromAddr: e.fromAddr,
        subject: e.subject,
        body: e.body.slice(0, 4000),
        summary: e.summary,
        labels: parseLabels(e.labelsJson),
        firmenrelevant: e.firmenrelevant,
        date: e.receivedAt.toISOString().slice(0, 16).replace("T", " "),
        customer: e.customer?.name ?? null,
      };
    }
    case "list_customers": {
      const cs = await prisma.customer.findMany({ include: { todos: true, emails: true }, orderBy: { name: "asc" } });
      return { customers: cs.map((c) => ({ name: c.name, offeneAufgaben: c.todos.filter((t) => !t.done).length, mails: c.emails.length })) };
    }
    case "list_open_todos": {
      const where: Prisma.TodoWhereInput = { done: false };
      if (a.customer_name) {
        const c = await findCustomer(a.customer_name);
        if (!c) return { todos: [] };
        where.customerId = c.id;
      }
      const todos = await prisma.todo.findMany({ where, include: { customer: true }, orderBy: { createdAt: "desc" }, take: 50 });
      return { todos: todos.map((t) => ({ text: t.text, customer: t.customer?.name ?? null })) };
    }
    case "assign_email_to_customer": {
      if (!a.email_id || !a.customer_name) return { error: "email_id und customer_name nötig" };
      const e = await prisma.email.findUnique({ where: { id: a.email_id } });
      if (!e) return { error: "E-Mail nicht gefunden" };
      const c = await findCustomer(a.customer_name, true);
      await prisma.email.update({ where: { id: a.email_id }, data: { customerId: c!.id } });
      return { ok: true, customer: c!.name, subject: e.subject };
    }
    case "file_to_accounting": {
      const e = a.email_id ? await prisma.email.findUnique({ where: { id: a.email_id } }) : null;
      if (!e) return { error: "E-Mail nicht gefunden" };
      await prisma.email.update({ where: { id: e.id }, data: { filed: true } });
      return { ok: true, subject: e.subject };
    }
    case "create_todo": {
      if (!a.text) return { error: "text nötig" };
      let customerId: string | null = null;
      if (a.customer_name) {
        const c = await findCustomer(a.customer_name, true);
        customerId = c!.id;
      }
      await prisma.todo.create({ data: { text: a.text, customerId } });
      return { ok: true, todo: a.text, customer: a.customer_name ?? null };
    }
    case "complete_todo": {
      if (!a.todo_text) return { error: "todo_text nötig" };
      const t = await prisma.todo.findFirst({ where: { done: false, text: { contains: a.todo_text, mode: "insensitive" } }, orderBy: { createdAt: "desc" } });
      if (!t) return { error: "Keine passende offene Aufgabe gefunden." };
      await prisma.todo.update({ where: { id: t.id }, data: { done: true } });
      return { ok: true, erledigt: t.text };
    }
    case "reopen_todo": {
      if (!a.todo_text) return { error: "todo_text nötig" };
      const t = await prisma.todo.findFirst({ where: { done: true, text: { contains: a.todo_text, mode: "insensitive" } }, orderBy: { createdAt: "desc" } });
      if (!t) return { error: "Keine passende erledigte Aufgabe gefunden." };
      await prisma.todo.update({ where: { id: t.id }, data: { done: false } });
      return { ok: true, wieder_offen: t.text };
    }
    case "remember_fact": {
      if (!a.content) return { error: "content nötig" };
      await prisma.memory.create({ data: { content: a.content, topic: a.topic ?? null } });
      return { ok: true, gemerkt: a.content };
    }
    case "recall_facts": {
      const where: Prisma.MemoryWhereInput = a.query
        ? { OR: [{ content: { contains: a.query, mode: "insensitive" } }, { topic: { contains: a.query, mode: "insensitive" } }] }
        : {};
      const ms = await prisma.memory.findMany({ where, orderBy: { updatedAt: "desc" }, take: 30 });
      return { facts: ms.map((m) => ({ topic: m.topic, content: m.content })) };
    }
    default:
      return { error: "unbekanntes Tool" };
  }
}

async function doDraft(emailId: string, instruction: string): Promise<{ result: unknown; drafted?: AssistantResult["draftedFor"] }> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return { result: { error: "E-Mail nicht gefunden" } };
  const text = await draftEmailReply({ fromName: email.fromName, fromAddr: email.fromAddr, subject: email.subject, body: email.body, instruction });
  const acc = await prisma.gmailAccount.findUnique({ where: { account: email.account } });
  const subject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;
  return {
    result: { ok: true, an: email.fromAddr, von: acc?.email ?? email.account },
    drafted: { emailId, text, fromName: email.fromName, toAddr: email.fromAddr, fromEmail: acc?.email ?? email.account, account: email.account, subject },
  };
}

async function doDraftNew(a: Args): Promise<{ result: unknown; newEmail?: AssistantResult["newEmail"] }> {
  let toAddr = (a.to || "").trim();
  let toName: string | null = null;
  if ((!toAddr || !toAddr.includes("@")) && a.customer_name) {
    const c = await findCustomer(a.customer_name);
    if (c) {
      const e = await prisma.email.findFirst({ where: { customerId: c.id }, orderBy: { receivedAt: "desc" } });
      if (e) {
        toAddr = e.fromAddr;
        toName = e.fromName;
      }
    }
  }
  if (!toAddr || !toAddr.includes("@")) {
    return { result: { error: "Keine gültige Empfänger-Adresse gefunden. Bitte E-Mail-Adresse angeben." } };
  }
  const account = a.account === "privat" ? "privat" : "firma";
  const acc = await prisma.gmailAccount.findUnique({ where: { account } });
  if (!acc?.refreshToken) return { result: { error: `Postfach ${account} ist nicht verbunden.` } };
  const composed = await composeEmail({ to: toName || toAddr, instruction: a.instruction || a.subject || "" });
  const subject = (a.subject || "").trim() || composed.subject;
  const body = composed.body;
  const pending = await prisma.pendingEmail.create({ data: { account, toAddr, toName, subject, body } });
  return {
    result: { ok: true, an: toAddr, betreff: subject },
    newEmail: { pendingId: pending.id, account, fromEmail: acc.email ?? account, toAddr, toName: toName ?? undefined, subject, body },
  };
}

export async function runAssistant(userText: string, context?: { replyEmailId?: string }): Promise<AssistantResult> {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) return { reply: "OpenAI-Key fehlt – ich kann gerade nicht antworten." };
  const model = (await getConfig("ASSISTANT_MODEL")) || (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  let drafted: AssistantResult["draftedFor"];
  let newEmail: AssistantResult["newEmail"];
  const today = new Date().toISOString().slice(0, 10);

  const memories = await prisma.memory.findMany({ orderBy: { updatedAt: "desc" }, take: 40 });
  const memText = memories.length ? memories.map((m) => `- ${m.topic ? "[" + m.topic + "] " : ""}${m.content}`).join("\n") : "(noch nichts gemerkt)";
  const history = (await prisma.botMessage.findMany({ orderBy: { createdAt: "desc" }, take: 16 })).reverse();
  // Arbeits-Gedächtnis (zuletzt gezeigte Mails / aktiver Entwurf) – frisch ohne Cache laden.
  const convRow = await prisma.setting.findUnique({ where: { key: "CONV_STATE" } });
  const convState = convRow?.value?.trim();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: ASSISTANT_PERSONA.replace("{DATUM}", today).replace("{MEMORIES}", memText) },
    ...(convState
      ? [{ role: "system" as const, content: `Arbeits-Kontext der letzten Nachricht (für Bezüge wie 'die zweite', 'ordne die zu', 'antworte ihm'):\n${convState}` }]
      : []),
    ...(context?.replyEmailId
      ? [{ role: "system" as const, content: `Der Nutzer antwortet gerade auf die E-Mail mit id=${context.replyEmailId}. Wenn er antworten möchte, nutze draft_reply mit dieser id.` }]
      : []),
    ...history.map((h) => ({ role: h.role === "assistant" ? ("assistant" as const) : ("user" as const), content: h.content })),
    { role: "user", content: userText },
  ];

  const lastEmails: { id: string; from: string; subject: string }[] = [];

  let finalReply = "";
  for (let i = 0; i < 6; i++) {
    const resp = await client.chat.completions.create({ model, temperature: 0.2, messages, tools: TOOLS });
    const m = resp.choices[0]?.message;
    if (!m) break;
    messages.push(m);
    if (!m.tool_calls?.length) {
      finalReply = (m.content ?? "").trim();
      break;
    }
    for (const tc of m.tool_calls) {
      let result: unknown;
      try {
        const args = JSON.parse(tc.function.arguments || "{}") as Args;
        if (tc.function.name === "draft_reply") {
          const r = await doDraft(String(args.email_id), String(args.instruction || ""));
          drafted = r.drafted ?? drafted;
          result = r.result;
        } else if (tc.function.name === "draft_new_email") {
          const r = await doDraftNew(args);
          newEmail = r.newEmail ?? newEmail;
          result = r.result;
        } else {
          result = await runTool(tc.function.name, args);
        }
      } catch (e) {
        result = { error: (e as Error).message };
      }
      if (tc.function.name === "search_emails") {
        const r = result as { emails?: Array<{ id: string; from: string; subject: string }> };
        if (r && Array.isArray(r.emails)) {
          lastEmails.length = 0;
          for (const e of r.emails.slice(0, 8)) lastEmails.push({ id: e.id, from: e.from, subject: e.subject });
        }
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  if (!finalReply && !drafted && !newEmail) finalReply = "Das habe ich nicht ganz verstanden – formulier es bitte anders.";

  // Gedächtnis aktualisieren + auf die letzten 40 Einträge begrenzen
  await prisma.botMessage.create({ data: { role: "user", content: userText.slice(0, 2000) } });
  await prisma.botMessage.create({ data: { role: "assistant", content: (drafted ? "[Antwort-Entwurf vorbereitet]" : newEmail ? "[Neue Mail vorbereitet]" : finalReply).slice(0, 2000) } });
  const old = await prisma.botMessage.findMany({ orderBy: { createdAt: "desc" }, skip: 40, select: { id: true } });
  if (old.length) await prisma.botMessage.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

  // Arbeits-Kontext für die nächste Nachricht festhalten (zuletzt gezeigte Mails / aktiver Entwurf).
  const ctxParts: string[] = [];
  if (lastEmails.length) ctxParts.push("Zuletzt gezeigte Mails:\n" + lastEmails.map((e, i) => `  ${i + 1}) id=${e.id} | ${e.from}: ${e.subject}`).join("\n"));
  if (drafted) ctxParts.push(`Aktiver Antwort-Entwurf: email id=${drafted.emailId} an ${drafted.fromName}`);
  if (ctxParts.length) {
    const v = ctxParts.join("\n");
    await prisma.setting.upsert({ where: { key: "CONV_STATE" }, create: { key: "CONV_STATE", value: v }, update: { value: v } });
  }

  return { reply: finalReply, draftedFor: drafted, newEmail };
}
