import { NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";

// Test-Push (und später: automatische Benachrichtigung bei wichtigen Mails)
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const text = (body?.text ?? "").toString().trim() || "🔔 Test vom ePower Cockpit";
  const result = await sendTelegram(text);
  return NextResponse.json(result);
}
