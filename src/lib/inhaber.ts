/**
 * Wer darf ins Cockpit? Das Supabase-Projekt teilen sich mehrere Apps – „irgendein angemeldetes
 * Konto“ ist also KEIN Beweis, dass es der Inhaber ist.
 *
 * Rollen:
 *  - "customer": Kunden-Mandant (app_metadata.role = "customer") – sieht nur /werbung + eigene Werbekonten
 *  - "admin":    der Inhaber – nur die hinterlegten User-IDs (Env INHABER_USER_IDS, kommagetrennt)
 *  - "none":     jedes andere Konto → kein Zugriff
 *
 * Läuft auch in der Middleware (Edge) – darum ohne Node-Module.
 */

// napetschnig.chris@gmail.com – der Inhaber (dem gehören auch alle CRM-Daten)
const STANDARD_INHABER = "83edc9c7-26a7-4f56-8806-cdfe253b9751";

function ids(roh: string): string[] {
  return roh.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Supabase-User-IDs des Inhabers. Leere/fehlende Env → Standard (sonst sperrt man sich selbst aus). */
export const INHABER_USER_IDS: readonly string[] = ids(process.env.INHABER_USER_IDS || "").length
  ? ids(process.env.INHABER_USER_IDS || "")
  : [STANDARD_INHABER];

export function istInhaber(userId: string | null | undefined): boolean {
  return !!userId && INHABER_USER_IDS.includes(userId.toLowerCase());
}

export type Rolle = "admin" | "customer" | "none";

/** Rolle eines angemeldeten Supabase-Users (app_metadata kann nur der Service-Role-Key setzen). */
export function rolleVon(user: { id: string; app_metadata?: unknown }): Rolle {
  // Inhaber zuerst – ein versehentlich gesetztes role="customer" darf ihn nie aussperren.
  if (istInhaber(user.id)) return "admin";
  if ((user.app_metadata as { role?: unknown } | null | undefined)?.role === "customer") return "customer";
  return "none";
}
