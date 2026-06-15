import { NextRequest, NextResponse } from "next/server";
import { handleCallback, type Account } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Google ruft das nach der Zustimmung auf: tauscht den Code gegen Tokens und speichert das Konto.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || (state !== "firma" && state !== "privat")) {
    return NextResponse.redirect(`${origin}/connect?error=${encodeURIComponent("Ungültige Antwort von Google")}`);
  }
  try {
    const { account, email } = await handleCallback(code, state as Account);
    return NextResponse.redirect(`${origin}/connect?connected=${account}&email=${encodeURIComponent(email ?? "")}`);
  } catch (e) {
    console.error("[gmail/callback]", e);
    return NextResponse.redirect(`${origin}/connect?error=${encodeURIComponent((e as Error).message)}`);
  }
}
