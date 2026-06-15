import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchNewRawMails, listAccounts, markSynced, isConfigured, type Account } from "@/lib/gmail";
import { classifyEmail } from "@/lib/openai";
import { sendTelegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Holt neue Mails aus allen verbundenen Postfächern, klassifiziert sie mit der KI,
 * legt sie in der DB ab und pusht wichtige firmenrelevante Mails per Telegram.
 */
export async function POST() {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Gmail nicht konfiguriert (GOOGLE_CLIENT_ID/SECRET fehlen)." }, { status: 503 });
  }
  const connected = (await listAccounts()).filter((a) => a.connected);
  if (connected.length === 0) {
    return NextResponse.json({ error: "Kein Postfach verbunden – zuerst unter /connect verbinden." }, { status: 400 });
  }

  let imported = 0;
  const perAccount: Record<string, number> = {};
  const errors: string[] = [];

  for (const a of connected) {
    try {
      const raws = await fetchNewRawMails(a.account as Account);
      let count = 0;
      for (const r of raws) {
        const c = await classifyEmail({
          account: r.account,
          fromName: r.fromName,
          fromAddr: r.fromAddr,
          subject: r.subject,
          body: r.body,
        });
        await prisma.email.create({
          data: {
            account: r.account,
            gmailId: r.gmailId,
            threadId: r.threadId,
            fromAddr: r.fromAddr,
            fromName: r.fromName,
            subject: r.subject,
            body: r.body,
            receivedAt: r.receivedAt,
            summary: c.summary,
            labelsJson: JSON.stringify(c.labels),
            firmenrelevant: c.firmenrelevant,
            priority: c.priority,
            classifiedAt: new Date(),
          },
        });
        count++;
        imported++;
        if (c.firmenrelevant && c.priority === "hi") {
          await sendTelegram(
            `📨 <b>Wichtig</b> · ${a.account}\n${esc(r.fromName)}: ${esc(r.subject)}\n${esc(c.summary)}`
          );
        }
      }
      perAccount[a.account] = count;
      await markSynced(a.account as Account);
    } catch (e) {
      console.error("[gmail/sync]", a.account, e);
      errors.push(`${a.account}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ imported, perAccount, errors });
}
