import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendTelegram } from "@/lib/telegram";
import { listEvents } from "@/lib/calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Wird alle paar Minuten vom Cron aufgerufen; erinnert ~20 Min vor einem Termin (einmal pro Termin).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (secret && !auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runReminders());
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function runReminders() {
  const LEAD_MIN = 20; // bis zu 20 Min vor Beginn erinnern
  const now = Date.now();

  const row = await prisma.setting.findUnique({ where: { key: "REMINDED_EVENTS" } });
  let reminded: { id: string; ts: number }[] = [];
  try {
    reminded = row?.value ? JSON.parse(row.value) : [];
  } catch {
    reminded = [];
  }
  const remindedSet = new Set(reminded.map((r) => r.id));

  let sent = 0;
  for (const acc of ["firma", "privat"] as const) {
    let evs;
    try {
      evs = await listEvents(acc, { days: 1 });
    } catch {
      continue; // Kalender-Scope evtl. nicht erteilt
    }
    for (const e of evs) {
      if (e.allDay || !e.id || remindedSet.has(e.id)) continue;
      const startMs = new Date(e.start).getTime();
      if (isNaN(startMs)) continue;
      const mins = (startMs - now) / 60000;
      if (mins > 0 && mins <= LEAD_MIN) {
        await sendTelegram(
          `⏰ <b>Termin in ${Math.round(mins)} Min</b>\n<b>${esc(e.summary)}</b> um ${e.start.slice(11, 16)}${e.location ? `\n📍 ${esc(e.location)}` : ""}`
        );
        reminded.push({ id: e.id, ts: now });
        remindedSet.add(e.id);
        sent++;
      }
    }
  }

  reminded = reminded.filter((r) => now - r.ts < 24 * 3600 * 1000); // alte aufräumen
  await prisma.setting.upsert({
    where: { key: "REMINDED_EVENTS" },
    create: { key: "REMINDED_EVENTS", value: JSON.stringify(reminded) },
    update: { value: JSON.stringify(reminded) },
  });

  // Wiedervorlagen: Mails, deren Snooze abgelaufen ist -> erneut melden
  const dueMails = await prisma.email.findMany({ where: { snoozedUntil: { not: null, lte: new Date() } }, take: 20 });
  for (const e of dueMails) {
    await sendTelegram(`🔔 <b>Wiedervorlage</b>\n<b>${esc(e.fromName)}</b>: ${esc(e.subject)}${e.summary ? "\n" + esc(e.summary) : ""}`);
    await prisma.email.update({ where: { id: e.id }, data: { snoozedUntil: null } });
    sent++;
  }

  // Fällige Aufgaben-Erinnerungen ("erinnere mich Montag an X")
  const dueTodos = await prisma.todo.findMany({ where: { done: false, remindedAt: null, dueAt: { not: null, lte: new Date() } }, include: { customer: true }, take: 20 });
  for (const t of dueTodos) {
    await sendTelegram(`⏰ <b>Erinnerung</b>\n${esc(t.text)}${t.customer ? " (" + esc(t.customer.name) + ")" : ""}`);
    await prisma.todo.update({ where: { id: t.id }, data: { remindedAt: new Date() } });
    sent++;
  }

  return { sent };
}
