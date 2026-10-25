import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Schützt die gesamte App über die Supabase-Session – Zugriff nur für den Inhaber (feste User-IDs,
// siehe lib/inhaber.ts) und Kunden-Konten (nur /werbung).
// Ausnahmen: Login-Seite, statische Dateien und die Endpunkte unten, die sich selbst absichern.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// Abgeschaltet (mit dem Inhaber abgesprochen) – der Routen-Code bleibt. Zum Wieder-Einschalten den
// Eintrag entfernen; Cron-Aufrufe (ohne Login) brauchen dann wieder eine Ausnahme wie /api/reminders
// unten, mit zeitkonstanter Schlüssel-Prüfung in der Route. Ohne Methode = alle Methoden.
const ABGESCHALTET: { pfad: string; methode?: string }[] = [
  { pfad: "/api/gmail/sync" }, // Gmail-Sync
  { pfad: "/api/briefing" }, // Morgen-Briefing
  { pfad: "/api/buchhaltung/worker" }, // BMD-/Buchhaltungs-Worker
  { pfad: "/api/ads/sync/crm-leads" }, // Meta-Leads → CRM
  // Nur der Cron-Lauf über alle Konten – POST (eigene Konten) braucht /werbung, auch die Kunden.
  { pfad: "/api/ads/sync/leads", methode: "GET" },
];

function abgeschaltet(req: NextRequest): boolean {
  const methode = req.method === "HEAD" ? "GET" : req.method;
  return ABGESCHALTET.some((a) => a.pfad === req.nextUrl.pathname && (!a.methode || a.methode === methode));
}

/** Kommt der Aufruf von einer fremden Seite? (Origin-Header gesetzt, aber nicht die eigene Adresse) */
function fremderUrsprung(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true; // z. B. "null"
  }
  const eigene = [req.nextUrl.host, req.headers.get("host"), req.headers.get("x-forwarded-host")?.split(",")[0].trim()];
  return !eigene.includes(host);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (abgeschaltet(req)) return NextResponse.json({ error: "abgeschaltet" }, { status: 410 });

  // Termin-Erinnerungen (Supabase pg_cron): die Route prüft den CRON_SECRET selbst – nur per
  // Authorization-Header und zeitkonstant (crypto.timingSafeEqual gibt es in der Edge-Middleware nicht).
  if (pathname === "/api/reminders") return NextResponse.next();

  // Telegram-Webhook ist öffentlich (durch eigenen Secret-Token abgesichert)
  if (pathname === "/api/telegram/webhook") return NextResponse.next();

  // Roboter am PC meldet nur IDs – Text und Empfänger baut der Endpunkt selbst aus der DB
  if (pathname === "/api/roboter/melden") return NextResponse.next();

  // Beleg-Versand aus der CRM-App: prüft das Supabase-Token selbst (inkl. CORS-Preflight)
  if (pathname === "/api/mail/send-document") return NextResponse.next();

  // CSRF: ändernde API-Aufrufe mit Cookie-Sitzung nur von der eigenen Seite aus.
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && fremderUrsprung(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { response, user, role } = await updateSession(req);

  // Login-Seite ist öffentlich (Session-Cookies trotzdem mitgeben)
  if (pathname === "/login") return response;

  if (!user) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Angemeldet, aber weder Inhaber noch Kunde (z. B. Konto einer anderen App im selben
  // Supabase-Projekt) → kein Zugriff. Die Login-Seite zeigt das an und meldet dort ab.
  if (role === "none") {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?kein_zugriff=1";
    return NextResponse.redirect(url);
  }

  // Kunden-Mandant: darf NUR die Werbung-Seite + die zugehörigen APIs sehen.
  if (role === "customer") {
    const allowed =
      pathname === "/werbung" ||
      pathname === "/api/ads" ||
      pathname.startsWith("/api/ads/") ||
      pathname.startsWith("/api/leads") ||
      pathname === "/api/me";
    if (!allowed) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const url = req.nextUrl.clone();
      url.pathname = "/werbung";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
