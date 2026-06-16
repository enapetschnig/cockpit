/**
 * Beleg-State-Übergänge – gemeinsame Quelle für die App-API UND den Telegram-Webhook,
 * damit "An BMD senden" / "Erneut versuchen" / "Ignorieren" überall identisch wirken.
 *
 * State-Machine: collected → queued → uploading → uploaded | failed
 *                failed → (retry) → queued ;  * → skipped
 * Der Worker (worker.ts) macht queued→uploading→uploaded/failed asynchron.
 */
import { prisma } from "../db";
import type { Beleg } from "@prisma/client";

const QUEUEABLE = new Set(["collected", "needs_review", "failed", "skipped"]);

/** Gibt einen Beleg zum BMD-Upload frei (status=queued). Idempotent. */
export async function queueBeleg(id: string, via: "app" | "telegram"): Promise<Beleg | null> {
  const b = await prisma.beleg.findUnique({ where: { id } });
  if (!b) return null;
  if (b.status === "queued" || b.status === "uploading" || b.status === "uploaded") return b;
  if (!QUEUEABLE.has(b.status)) return b;
  return prisma.beleg.update({
    where: { id },
    data: { status: "queued", approvedAt: new Date(), approvedVia: via, bmdError: null },
  });
}

/** Gibt ALLE noch nicht abgelegten Belege frei. Gibt die Anzahl zurück. */
export async function approveAllCollected(via: "app" | "telegram"): Promise<number> {
  const r = await prisma.beleg.updateMany({
    where: { status: { in: ["collected", "needs_review", "failed"] } },
    data: { status: "queued", approvedAt: new Date(), approvedVia: via, bmdError: null },
  });
  return r.count;
}

/** Nochmal versuchen (nur aus failed). */
export async function retryBeleg(id: string): Promise<Beleg | null> {
  const b = await prisma.beleg.findUnique({ where: { id } });
  if (!b) return null;
  if (b.status !== "failed" && b.status !== "needs_review") return b;
  return prisma.beleg.update({ where: { id }, data: { status: "queued", bmdError: null, taskId: null } });
}

/** Beleg ignorieren (nicht ans BMD). */
export async function skipBeleg(id: string): Promise<Beleg | null> {
  const b = await prisma.beleg.findUnique({ where: { id } });
  if (!b) return null;
  return prisma.beleg.update({ where: { id }, data: { status: "skipped" } });
}
