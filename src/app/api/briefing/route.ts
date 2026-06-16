import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { sendTelegram } from "@/lib/telegram";
import { listEvents } from "@/lib/calendar";
import { listFollowups } from "@/lib/followups";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Wird stündlich vom Cron aufgerufen; sendet nur um 8:00 (Europe/Vienna) – einmal pro Tag.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (secret && !auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const force = url.searchParams.get("force") === "1";
  return NextResponse.json(await runBriefing(force));
}

function viennaParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripMd(s: string): string {
  return (s || "").replace(/\*\*/g, "").replace(/__/g, "").replace(/^#{1,6}\s*/gm, "").replace(/^\s*[-*]\s+/gm, "• ");
}

async function runBriefing(force: boolean) {
  const now = new Date();
  const { date, hour } = viennaParts(now);
  if (!force && hour !== 8) return { skipped: `nicht 8 Uhr (Wien: ${hour})` };

  const last = await getConfig("LAST_BRIEFING_DATE");
  if (!force && last === date) return { skipped: "heute bereits gesendet" };

  // Nur NEUE wichtige Mails seit dem letzten Briefing (keine Wiederholungen).
  // Fallback beim allerersten Mal: letzte 32h.
  const lastAt = await getConfig("LAST_BRIEFING_AT");
  const since = lastAt ? new Date(lastAt) : new Date(now.getTime() - 32 * 3600 * 1000);
  const mails = await prisma.email.findMany({
    where: { outgoing: false, receivedAt: { gte: since }, OR: [{ firmenrelevant: true }, { priority: "hi" }] },
    orderBy: { receivedAt: "desc" },
    take: 30,
    include: { customer: true },
  });

  // Heutige Termine aus beiden Kalendern (Mails UND Kalender im Briefing).
  const todays: string[] = [];
  for (const acc of ["firma", "privat"] as const) {
    try {
      const evs = await listEvents(acc, { days: 2, max: 25 });
      for (const e of evs) {
        if ((e.start || "").slice(0, 10) === date) {
          const t = e.allDay ? "ganztägig" : e.start.slice(11, 16);
          todays.push(`${t}  ${e.summary}${e.location ? " @ " + e.location : ""}  (${acc})`);
        }
      }
    } catch {
      /* Kalender-Scope evtl. (noch) nicht erteilt -> überspringen */
    }
  }
  todays.sort();
  const eventPart = todays.length ? "\n\n📅 <b>Heute:</b>\n" + esc(todays.map((e) => "• " + e).join("\n")) : "";

  // Mails-Teil (ohne Begrüßung).
  let mailPart: string;
  if (mails.length === 0) {
    mailPart = "Keine neuen wichtigen Mails seit gestern.";
  } else {
    const lines = mails.map(
      (m) => `- [${m.account}${m.priority === "hi" ? ", dringend" : ""}] ${m.fromName}: ${m.subject}${m.summary ? " — " + m.summary : ""}`
    );
    const structured =
      `${mails.length} wichtige Mail(s) seit gestern:\n\n` +
      esc(mails.map((m) => `• ${m.priority === "hi" ? "❗️ " : ""}${m.fromName}: ${m.subject}${m.summary ? "\n   ↳ " + m.summary : ""}`).join("\n"));

    const apiKey = await getConfig("OPENAI_API_KEY");
    if (apiKey) {
      try {
        const model = (await getConfig("OPENAI_MODEL")) || "gpt-4o-mini";
        const client = new OpenAI({ apiKey });
        const resp = await client.chat.completions.create({
          model,
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content:
                "Du schreibst eine kurze, freundliche Morgen-Übersicht für den Inhaber der ePower GmbH (Software für Handwerker). " +
                "Deutsch, für Telegram: einfacher Text + Emojis, KEIN Markdown (kein Sternchen-Fett, keine Rauten). " +
                "Fasse die wichtigen Mails knapp zusammen, das Dringendste zuerst, max ~10 Zeilen. Beginne NICHT mit einer Begrüßung.",
            },
            { role: "user", content: `Wichtige Mails seit gestern:\n${lines.join("\n")}` },
          ],
        });
        const ai = resp.choices[0]?.message?.content?.trim();
        mailPart = ai ? esc(stripMd(ai)) : structured;
      } catch {
        mailPart = structured;
      }
    } else {
      mailPart = structured;
    }
  }

  // Follow-ups: was wartet seit Tagen auf Antwort
  let fupPart = "";
  try {
    const fups = await listFollowups(48, 8);
    if (fups.length) fupPart = "\n\n🔔 <b>Wartet auf Antwort:</b>\n" + esc(fups.map((e) => `• ${e.fromName}: ${e.subject}`).join("\n"));
  } catch {
    /* ignore */
  }

  const text =
    mails.length === 0 && todays.length === 0 && !fupPart
      ? "☀️ <b>Guten Morgen!</b>\nKeine neuen wichtigen Mails und keine Termine heute – entspannter Start! 👍"
      : "☀️ <b>Guten Morgen!</b>\n\n" + mailPart + eventPart + fupPart;

  const res = await sendTelegram(text);
  // Zeitstempel + Datum merken, damit das nächste Briefing nur Neueres zeigt.
  const nowIso = now.toISOString();
  await prisma.setting.upsert({ where: { key: "LAST_BRIEFING_DATE" }, create: { key: "LAST_BRIEFING_DATE", value: date }, update: { value: date } });
  await prisma.setting.upsert({ where: { key: "LAST_BRIEFING_AT" }, create: { key: "LAST_BRIEFING_AT", value: nowIso }, update: { value: nowIso } });
  return { sent: res.ok, count: mails.length, events: todays.length, since: since.toISOString(), date };
}
