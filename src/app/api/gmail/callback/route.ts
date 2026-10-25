import { NextRequest, NextResponse } from "next/server";
import { handleCallback, parseOAuthState, OAUTH_NONCE_COOKIE, OAUTH_NONCE_COOKIE_OPTIONS } from "@/lib/gmail";
import { timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

/** Nonce aus `state` und Cookie zeitkonstant vergleichen. */
function sameNonce(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

// Google ruft das nach der Zustimmung auf: tauscht den Code gegen Tokens und speichert das Konto.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = parseOAuthState(req.nextUrl.searchParams.get("state"));
  const cookieNonce = req.cookies.get(OAUTH_NONCE_COOKIE)?.value ?? "";

  // Zurück zur Verbinden-Seite – das Nonce-Cookie gilt nur für einen Versuch und wird immer gelöscht.
  const back = (query: string) => {
    const res = NextResponse.redirect(`${origin}/connect?${query}`);
    res.cookies.set(OAUTH_NONCE_COOKIE, "", { ...OAUTH_NONCE_COOKIE_OPTIONS, maxAge: 0 });
    return res;
  };
  const fail = (msg: string) => back(`error=${encodeURIComponent(msg)}`);

  if (!code || !state) return fail("Ungültige Antwort von Google");
  // Login-CSRF-Schutz: nur ein Flow, der in diesem Browser über /api/gmail/connect gestartet wurde
  if (!sameNonce(state.nonce, cookieNonce)) {
    return fail("Sicherheitsprüfung fehlgeschlagen (Anmeldung abgelaufen oder nicht hier gestartet) – bitte das Postfach erneut verbinden.");
  }
  try {
    const redirectUri = new URL("/api/gmail/callback", origin).toString();
    const { account, email } = await handleCallback(code, state.account, redirectUri);
    return back(`connected=${account}&email=${encodeURIComponent(email ?? "")}`);
  } catch (e) {
    console.error("[gmail/callback]", e);
    return fail((e as Error).message);
  }
}
