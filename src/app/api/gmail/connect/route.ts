import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl, isConfigured, type Account } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Startet den Google-OAuth-Flow für ein Postfach: /api/gmail/connect?account=firma|privat
export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account");
  if (account !== "firma" && account !== "privat") {
    return NextResponse.json({ error: "account muss 'firma' oder 'privat' sein" }, { status: 400 });
  }
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Gmail nicht konfiguriert – GOOGLE_CLIENT_ID/SECRET fehlen (.env). Siehe docs/09-gmail-anbindung.md" },
      { status: 503 }
    );
  }
  return NextResponse.redirect(getAuthUrl(account as Account));
}
