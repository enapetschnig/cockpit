/**
 * Autorisierung für die Ads-/CRM-Routen: liest den eingeloggten Supabase-User
 * (inkl. Rolle aus app_metadata) und prüft den Mandanten-Zugriff auf ein Werbekonto.
 *
 * Rollen: "admin" (= ePower-Inhaber, sieht alles) | "customer" (sieht nur eigene Konten).
 * Fehlende Rolle wird als admin behandelt (Bestandskonto des Inhabers).
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { AdAccount, Prisma } from "@prisma/client";
import { prisma } from "./db";

export interface SessionUser {
  userId: string;
  email: string | null;
  role: "admin" | "customer";
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        /* in Route-Handlern nicht nötig – die Middleware aktualisiert die Cookies */
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const role = (user.app_metadata as { role?: string } | undefined)?.role === "customer" ? "customer" : "admin";
  return { userId: user.id, email: user.email ?? null, role };
}

/** Prisma-where, das nur die für den User sichtbaren Konten zulässt (Admin: alle). */
export function accountScope(user: SessionUser): Prisma.AdAccountWhereInput {
  return user.role === "admin" ? {} : { ownerUserId: user.userId };
}

type AccessResult = { ok: true; user: SessionUser; account: AdAccount } | { ok: false; status: number; error: string };

/** Stellt sicher, dass der eingeloggte User auf das Werbekonto zugreifen darf. */
export async function requireAccountAccess(accountId: string): Promise<AccessResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401, error: "Nicht angemeldet" };
  if (!accountId) return { ok: false, status: 400, error: "accountId nötig" };
  const account = await prisma.adAccount.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, status: 404, error: "Werbekonto nicht gefunden" };
  if (user.role !== "admin" && account.ownerUserId !== user.userId) {
    return { ok: false, status: 403, error: "Kein Zugriff auf dieses Werbekonto" };
  }
  return { ok: true, user, account };
}
