import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { classifyEmail } from "@/lib/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ordnet ALLE vorhandenen Mails neu ein (z. B. nachdem ein OpenAI-Key gesetzt wurde).
 * Verschickt KEINE Push-Nachrichten – ist reine Neu-Klassifizierung.
 */
export async function POST() {
  const emails = await prisma.email.findMany({ orderBy: { receivedAt: "desc" } });
  let updated = 0;
  const errors: string[] = [];

  for (const e of emails) {
    try {
      const c = await classifyEmail({
        account: e.account,
        fromName: e.fromName,
        fromAddr: e.fromAddr,
        subject: e.subject,
        body: e.body,
      });
      await prisma.email.update({
        where: { id: e.id },
        data: {
          summary: c.summary,
          labelsJson: JSON.stringify(c.labels),
          firmenrelevant: c.firmenrelevant,
          priority: c.priority,
          classifiedAt: new Date(),
        },
      });
      updated++;
    } catch (err) {
      errors.push(`${e.id}: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({ updated, total: emails.length, errors });
}
