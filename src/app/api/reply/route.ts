import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftEmailReply } from "@/lib/openai";
import { getThreadContext, type Account } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { emailId, instruction? } -> KI-Antwort-Entwurf (kein Senden)
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { emailId?: string; instruction?: string };
  const email = body.emailId ? await prisma.email.findUnique({ where: { id: body.emailId } }) : null;
  if (!email) return NextResponse.json({ error: "Mail nicht gefunden" }, { status: 404 });

  const instruction = (body.instruction ?? "").trim() || "Antworte freundlich, knapp und passend auf diese Mail.";
  const thread = email.threadId ? await getThreadContext(email.account as Account, email.threadId).catch(() => "") : "";
  const acc = await prisma.gmailAccount.findUnique({ where: { account: email.account } });
  const text = await draftEmailReply({
    fromName: email.fromName,
    fromAddr: email.fromAddr,
    subject: email.subject,
    body: email.body,
    instruction,
    context: thread || undefined,
  });
  const subject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;
  return NextResponse.json({ text, subject, to: email.fromAddr, from: acc?.email ?? email.account });
}
