import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { classifyEmail } from "@/lib/openai";
import { toEmailDTO } from "@/lib/serialize";

// Klassifiziert eine Mail neu (Zusammenfassung, Labels, Firmenrelevanz, Priorität)
// und speichert das Ergebnis. Nutzt OpenAI, wenn OPENAI_API_KEY gesetzt ist – sonst Regel-Fallback.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const emailId = body?.emailId as string | undefined;
  if (!emailId) return NextResponse.json({ error: "emailId fehlt" }, { status: 400 });

  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return NextResponse.json({ error: "Mail nicht gefunden" }, { status: 404 });

  const result = await classifyEmail({
    account: email.account,
    fromName: email.fromName,
    fromAddr: email.fromAddr,
    subject: email.subject,
    body: email.body,
  });

  const updated = await prisma.email.update({
    where: { id: emailId },
    data: {
      summary: result.summary,
      labelsJson: JSON.stringify(result.labels),
      firmenrelevant: result.firmenrelevant,
      priority: result.priority,
      classifiedAt: new Date(),
    },
    include: { customer: true },
  });

  return NextResponse.json({ email: toEmailDTO(updated), suggestedTodos: result.suggestedTodos });
}
