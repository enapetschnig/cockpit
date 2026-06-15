/**
 * Gmail-Anbindung – STUB für Phase 1 (kommt als nächster echter Schritt).
 *
 * Aktuell läuft das Cockpit auf den Seed-Daten in der DB. Dieses Modul beschreibt
 * die echte Anbindung, damit der nächste Schritt klar ist.
 *
 * Echte Umsetzung (zwei Konten: Firma + privat):
 *  1) Google Cloud Projekt + OAuth-Client (Scope: gmail.readonly, gmail.send).
 *  2) Pro Konto OAuth-Flow -> Refresh-Token speichern (verschlüsselt).
 *  3) Echtzeit: Gmail API `users.watch` auf ein Pub/Sub-Topic (alle 7 Tage erneuern).
 *  4) Pub/Sub-Push -> /api/gmail/webhook -> `users.history.list` ab letzter historyId
 *     -> neue Mails laden -> classifyEmail() -> in DB speichern -> ggf. Telegram-Push.
 *
 * Empfehlung: `googleapis` (npm) für OAuth + Gmail-Calls ergänzen.
 */

export interface RawMail {
  account: "firma" | "privat";
  fromAddr: string;
  fromName: string;
  subject: string;
  body: string;
  receivedAt: Date;
}

export function getAuthUrl(_account: "firma" | "privat"): string {
  throw new Error("Gmail-OAuth noch nicht implementiert – siehe Kommentar in src/lib/gmail.ts");
}

export async function syncMailbox(_account: "firma" | "privat"): Promise<RawMail[]> {
  // TODO: echte history.list-Abfrage. Phase 1 nutzt vorerst die Seed-Daten.
  return [];
}
