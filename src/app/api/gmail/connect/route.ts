import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl, isGmailConfigured, OAUTH_NONCE_COOKIE, OAUTH_NONCE_COOKIE_OPTIONS, type Account } from "@/lib/gmail";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

// Startet den Google-OAuth-Flow für ein Postfach: /api/gmail/connect?account=firma|privat
export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account");
  if (account !== "firma" && account !== "privat") {
    return NextResponse.json({ error: "account muss 'firma' oder 'privat' sein" }, { status: 400 });
  }
  if (!(await isGmailConfigured())) {
    return NextResponse.json(
      { error: "Gmail nicht konfiguriert – GOOGLE_CLIENT_ID/SECRET fehlen. Eintragen unter /connect → Einstellungen." },
      { status: 503 }
    );
  }
  // Redirect-URI aus der aktuellen Adresse ableiten (localhost ODER Vercel-URL) – kein Env nötig.
  const redirectUri = new URL("/api/gmail/callback", req.nextUrl.origin).toString();
  // Nonce gegen Login-CSRF: steht im state UND im Cookie – ein fremder Google-Code passt so nie dazu.
  const nonce = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(await getAuthUrl(account as Account, redirectUri, nonce));
  res.cookies.set(OAUTH_NONCE_COOKIE, nonce, OAUTH_NONCE_COOKIE_OPTIONS);
  return res;
}
