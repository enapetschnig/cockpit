import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Schützt die gesamte App über die Supabase-Session.
// Ausnahmen: Login-Seite, statische Dateien, und der Cron-Endpunkt (CRON_SECRET).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Vercel-Cron darf den Sync auch ohne Login (per CRON_SECRET)
  if (pathname === "/api/gmail/sync") {
    const cron = process.env.CRON_SECRET;
    if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return NextResponse.next();
  }

  // Telegram-Webhook ist öffentlich (durch eigenen Secret-Token abgesichert)
  if (pathname === "/api/telegram/webhook") return NextResponse.next();

  const { response, user } = await updateSession(req);

  // Login-Seite ist öffentlich (Session-Cookies trotzdem mitgeben)
  if (pathname === "/login") return response;

  if (!user) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
