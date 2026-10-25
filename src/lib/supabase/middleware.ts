import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { rolleVon, type Rolle } from "@/lib/inhaber";

/**
 * Erneuert die Supabase-Session und liefert den eingeloggten User (oder null).
 * Muss in der Middleware laufen, damit Auth-Cookies aktuell bleiben.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Kunde (app_metadata) / Inhaber (feste User-IDs) / sonst kein Zugriff – siehe lib/inhaber.ts
  const role: Rolle = user ? rolleVon(user) : "none";
  return { response, user, role };
}
