/**
 * BMD-Upload-Worker – wird vom Cron (/api/buchhaltung/worker, alle 2 Min) getriggert.
 * Drei billige Phasen pro Tick, nie blockierend:
 *   1) laufende Tasks pollen (uploading) → uploaded / failed
 *   2) freigegebene Belege (queued) atomar claimen → browser-use Task starten → taskId merken
 * Stuck-Detection: hängt ein Task > STUCK_MINUTES, → needs_review (NIE Auto-Retry → kein Doppel-Upload).
 */
import { prisma } from "../db";
import { signedUrl } from "../supabase/server";
import { startBmdUpload, getTask, isBrowserUseConfigured } from "./browseruse";
import { sendTelegram } from "../telegram";

const WORKER_BATCH = 2; // max. parallele Starts pro Tick
const STUCK_MINUTES = 20;

export interface WorkerResult {
  polled: number;
  started: number;
  uploaded: number;
  failed: number;
  skipped: string[];
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function runBmdWorker(): Promise<WorkerResult> {
  const res: WorkerResult = { polled: 0, started: 0, uploaded: 0, failed: 0, skipped: [] };
  if (!(await isBrowserUseConfigured())) {
    res.skipped.push("browser-use nicht konfiguriert");
    return res;
  }

  // ── Phase 1: laufende Uploads pollen ───────────────────────
  const running = await prisma.beleg.findMany({ where: { status: "uploading", taskId: { not: null } } });
  for (const b of running) {
    res.polled++;
    try {
      const t = await getTask(b.taskId!);
      if (!t.done) {
        // Hängt der Task zu lange? -> needs_review, nicht automatisch neu starten.
        const startedMs = b.taskStartedAt ? b.taskStartedAt.getTime() : 0;
        if (startedMs && Date.now() - startedMs > STUCK_MINUTES * 60_000) {
          await prisma.beleg.update({
            where: { id: b.id },
            data: { status: "needs_review", bmdError: `Task hängt seit >${STUCK_MINUTES} Min (manuell prüfen)` },
          });
        }
        continue;
      }
      const ok = t.isSuccess === true || (t.isSuccess === null && !t.error && !!t.confirmation);
      if (ok) {
        await prisma.beleg.update({
          where: { id: b.id },
          data: { status: "uploaded", bmdUploadedAt: new Date(), confirmation: t.confirmation || t.output || "ok", bmdError: null },
        });
        res.uploaded++;
        await sendTelegram(`✅ <b>${esc(b.vendor)} an BMD übermittelt</b>${t.confirmation ? ` · ${esc(t.confirmation)}` : ""}`).catch(() => {});
      } else {
        await prisma.beleg.update({
          where: { id: b.id },
          data: { status: "failed", bmdError: t.error || "Upload fehlgeschlagen" },
        });
        res.failed++;
        await sendTelegram(
          `⚠️ <b>BMD-Upload fehlgeschlagen</b> · ${esc(b.vendor)}\n${esc(t.error || "unbekannt")}`,
          { buttons: [[{ text: "↻ Erneut senden", data: `bmdr:${b.id}` }]] }
        ).catch(() => {});
      }
    } catch (e) {
      console.error("[bmd-worker] poll", b.id, (e as Error).message);
    }
  }

  // ── Phase 2: freigegebene Belege claimen + Task starten ────
  const queued = await prisma.beleg.findMany({ where: { status: "queued" }, orderBy: { approvedAt: "asc" }, take: WORKER_BATCH });
  for (const b of queued) {
    // Atomic claim: nur EIN Tick gewinnt.
    const claimed = await prisma.beleg.updateMany({
      where: { id: b.id, status: "queued" },
      data: { status: "uploading", taskStartedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    try {
      if (!b.storagePath) throw new Error("kein storagePath");
      const url = await signedUrl(b.storagePath, 1800);
      const { taskId } = await startBmdUpload({
        pdfUrl: url,
        fileName: b.fileName || "beleg.pdf",
        vendor: b.vendor,
        invoiceNumber: b.invoiceNumber,
      });
      await prisma.beleg.update({ where: { id: b.id }, data: { taskId } });
      res.started++;
    } catch (e) {
      await prisma.beleg.update({
        where: { id: b.id },
        data: { status: "failed", bmdError: (e as Error).message, taskId: null },
      });
      res.failed++;
      console.error("[bmd-worker] start", b.id, (e as Error).message);
    }
  }

  return res;
}
