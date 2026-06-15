import { NextResponse, NextRequest } from "next/server";

// Schützt die gesamte App. Ausnahmen: Login-Seite, Auth-API, statische Dateien,
// und der Cron-Endpunkt (mit gültigem CRON_SECRET).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toLogin(req: NextRequest, reason?: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = reason ? `?reason=${reason}` : "";
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Öffentlich erreichbar
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();

  // Vercel-Cron darf den Sync auch ohne Login (per CRON_SECRET)
  if (pathname === "/api/gmail/sync") {
    const cron = process.env.CRON_SECRET;
    if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) return toLogin(req, "nosecret"); // fail-closed

  const expected = await sha256Hex(secret);
  if (req.cookies.get("cockpit_auth")?.value === expected) return NextResponse.next();

  // Nicht eingeloggt
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return toLogin(req);
}
