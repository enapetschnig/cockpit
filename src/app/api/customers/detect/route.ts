import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PALETTE = ["#2f6df0", "#1f9d63", "#d8932a", "#e0533d", "#9a4fc4", "#1c8a90", "#5a6675"];

interface Verdict {
  nr: number;
  isCustomer: boolean;
  customerName: string;
}

/**
 * Erkennt aus den firmenrelevanten Mails echte KUNDEN (Handwerksbetriebe, die bei der
 * ePower GmbH Software beauftragen/nutzen) – im Gegensatz zu Diensten, Lieferanten,
 * Steuerberater, Marktplätzen, Newslettern. Legt erkannte Kunden an und ordnet ihre Mails zu.
 */
export async function POST() {
  const apiKey = await getConfig("OPENAI_API_KEY");
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI-Key fehlt – die Kundenerkennung braucht KI." }, { status: 503 });
  }
  const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";

  const emails = await prisma.email.findMany({ where: { firmenrelevant: true } });
  if (emails.length === 0) return NextResponse.json({ created: 0, assigned: 0, customers: [] });

  // Eigene Firma / verbundene Konten ausschließen – man ist nicht sein eigener Kunde.
  const accounts = await prisma.gmailAccount.findMany();
  const ownAddrs = new Set(accounts.map((a) => (a.email || "").toLowerCase()).filter(Boolean));
  const ownDomains = new Set<string>(["epowergmbh.at"]);
  for (const a of accounts) {
    const d = (a.email || "").split("@")[1]?.toLowerCase();
    if (d && d !== "gmail.com" && d !== "googlemail.com") ownDomains.add(d);
  }

  // Absender bündeln (mit Beispiel-Betreffs als Kontext)
  const bySender = new Map<string, { fromName: string; fromAddr: string; subjects: string[] }>();
  for (const e of emails) {
    const key = e.fromAddr.toLowerCase();
    const domain = key.split("@")[1] || "";
    if (ownAddrs.has(key) || ownDomains.has(domain)) continue; // eigene Firma -> kein Kunde
    if (!bySender.has(key)) bySender.set(key, { fromName: e.fromName, fromAddr: e.fromAddr, subjects: [] });
    const s = bySender.get(key)!;
    if (s.subjects.length < 3) s.subjects.push(e.subject);
  }
  const senders = [...bySender.values()];

  const client = new OpenAI({ apiKey });
  const userPrompt = [
    "Die ePower GmbH entwickelt INDIVIDUELLE SOFTWARE für Handwerker (Tischler, Elektriker, Installateure, Bau, …).",
    "Unten Absender aus dem Posteingang. Entscheide pro Absender:",
    "- isCustomer=true  → ein echter KUNDE/Interessent (Handwerks-/Geschäftsbetrieb, der bei ePower Software beauftragt, nutzt oder anfragt).",
    "- isCustomer=false → KEIN Kunde: Dienste/Tools (z. B. Supabase, PayPal, Google, Apple), Lieferanten/Hosting (Hetzner, A1),",
    "  Banken, Steuerberater, Marktplätze (willhaben), Newsletter/Communities, private Mails.",
    "Im Zweifel isCustomer=false. customerName = sauberer Firmenname (nur wenn isCustomer=true, sonst \"\").",
    "",
    'Antworte NUR mit JSON: { "results": [ { "nr": 1, "isCustomer": true, "customerName": "..." } ] }',
    "nr = die Nummer des Absenders aus der Liste unten (genau übernehmen).",
    "",
    "Absender:",
    ...senders.map((s, i) => `${i + 1}. ${s.fromName} <${s.fromAddr}> — Betreffe: ${s.subjects.join(" | ")}`),
  ].join("\n");

  let results: Verdict[] = [];
  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Du erkennst echte Kunden in Posteingängen. Antworte AUSSCHLIESSLICH mit gültigem JSON." },
        { role: "user", content: userPrompt },
      ],
    });
    const j = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
    results = Array.isArray(j.results) ? (j.results as Verdict[]) : [];
  } catch (e) {
    return NextResponse.json({ error: "KI-Analyse fehlgeschlagen: " + (e as Error).message }, { status: 500 });
  }

  let created = 0;
  let assigned = 0;
  const createdNames: string[] = [];
  const nameToId = new Map<string, string>();
  let colorIdx = await prisma.customer.count();

  for (const r of results) {
    if (!r?.isCustomer || !r.customerName?.trim()) continue;
    const sender = senders[(Number(r.nr) || 0) - 1];
    if (!sender) continue;
    const name = r.customerName.trim();
    const lname = name.toLowerCase();

    let customerId = nameToId.get(lname);
    if (!customerId) {
      const existing = await prisma.customer.findFirst({ where: { name } });
      if (existing) {
        customerId = existing.id;
      } else {
        const c = await prisma.customer.create({ data: { name, color: PALETTE[colorIdx++ % PALETTE.length] } });
        customerId = c.id;
        created++;
        createdNames.push(name);
      }
      nameToId.set(lname, customerId);
    }

    const upd = await prisma.email.updateMany({
      where: { fromAddr: { equals: sender.fromAddr, mode: "insensitive" }, firmenrelevant: true, customerId: null, filed: false },
      data: { customerId },
    });
    assigned += upd.count;
  }

  return NextResponse.json({ created, assigned, customers: createdNames });
}
