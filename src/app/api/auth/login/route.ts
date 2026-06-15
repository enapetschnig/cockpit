import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Prüft das Passwort (aus Supabase/Setting APP_PASSWORD) und setzt das Login-Cookie.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const input = String(body?.password ?? "");
  const pw = await getConfig("APP_PASSWORD");
  const secret = process.env.SESSION_SECRET;

  if (!pw || !secret) {
    return NextResponse.json({ error: "Server nicht konfiguriert (APP_PASSWORD / SESSION_SECRET fehlen)." }, { status: 503 });
  }
  if (!input || input !== pw) {
    return NextResponse.json({ error: "Falsches Passwort." }, { status: 401 });
  }

  const token = crypto.createHash("sha256").update(secret).digest("hex");
  const res = NextResponse.json({ ok: true });
  res.cookies.set("cockpit_auth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 Tage
  });
  return res;
}
