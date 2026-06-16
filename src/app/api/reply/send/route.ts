import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendReply, type Account } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { emailId, text } -> sendet die (kontrollierte) Antwort
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { emailId?: string; text?: string };
  const text = (body.text ?? "").trim();
  const email = body.emailId ? await prisma.email.findUnique({ where: { id: body.emailId } }) : null;
  if (!email || !email.gmailId) return NextResponse.json({ error: "Mail nicht gefunden" }, { status: 404 });
  if (!text) return NextResponse.json({ error: "Text fehlt" }, { status: 400 });
  const res = await sendReply(email.account as Account, email.gmailId, text);
  return NextResponse.json({ ok: true, to: res.to });
}
