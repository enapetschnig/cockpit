/**
 * Lokaler BMD-Upload-Runner (läuft auf Christophs Mac – nur sein Netz erreicht das Portal).
 * Holt freigegebene Belege (status="queued"), lädt sie ins BMD-Com-Webportal und setzt die
 * Beschreibung. Deterministisch & schnell (Playwright) → schlägt die Sekunden-Session.
 *
 *   npm run bmd:upload
 *
 * Ordner-Routing (lt. Christoph):
 *   - bank-bezahlt  → "ER Eingangsrechnungen"
 *   - kreditkarte   → "Weitere → KK Kreditkarte"
 *   Bank vs. Kreditkarte kommt aus dem Abgleich (welche Auszugs-Buchung die Rechnung matcht).
 * Beschreibung: "<Vendor> <Monat>/<JJ>"  z. B. "hellocash 6/26".
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { getConfig } from "../src/lib/config";
import { signedUrl } from "../src/lib/supabase/server";
import type { Beleg } from "@prisma/client";

const HEADLESS = process.env.BMD_HEADFUL ? false : true;
const MAX_PER_RUN = Number(process.env.BMD_MAX || 10);

type Folder = "eingang" | "kreditkarte";
const FOLDER_TREE: Record<Folder, RegExp> = {
  eingang: /ER\s+Eingangsrechnung/i,
  kreditkarte: /KK\s+Kreditkarte\b/i,
};

/** "2026-06" → "6/26" */
function periodShort(periodMonth: string | null): string {
  if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) return "";
  const [y, m] = periodMonth.split("-");
  return `${Number(m)}/${y.slice(2)}`;
}
function descriptionFor(b: Beleg): string {
  return [b.vendor, periodShort(b.periodMonth)].filter(Boolean).join(" ");
}
/** "2026-06" → "6/2026" (BMD-Buchungsperiode) */
function periodLong(periodMonth: string | null): string {
  if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) return "";
  const [y, m] = periodMonth.split("-");
  return `${Number(m)}/${y}`;
}

/** Bank vs. Kreditkarte aus dem Abgleich ableiten. */
async function folderForBeleg(b: Beleg): Promise<Folder> {
  if (b.kind === "kreditkarte") return "kreditkarte";
  if (b.kind === "kontoauszug") return "eingang";
  const match = await prisma.buchung.findFirst({
    where: { matchedBelegId: b.id, matchStatus: "matched" },
    include: { beleg: true },
  });
  return match?.beleg?.kind === "kreditkarte" ? "kreditkarte" : "eingang";
}

async function login(page: Page, url: string, customer: string, user: string, pass: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#txtclientno-inputEl", { timeout: 20000 });
  await page.fill("#txtclientno-inputEl", customer);
  await page.fill("#txtuser-inputEl", user);
  await page.fill("#txtpass-inputEl", pass);
  await page.click("#loginbutton");
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.getByText("Buchhaltungs-Belege hochladen", { exact: false }).first().waitFor({ timeout: 15000 });
}

async function openUploader(page: Page): Promise<void> {
  await page.getByText("Buchhaltungs-Belege hochladen", { exact: false }).first().click();
  await page.getByText("Dateien hochladen", { exact: false }).first().waitFor({ timeout: 15000 });
}

async function selectFolder(page: Page, folder: Folder): Promise<void> {
  await page.getByText(FOLDER_TREE[folder]).first().click({ timeout: 10000 });
  // Drop-Zone-Label spiegelt den gewählten Ordner – kurz warten bis es wechselt.
  await page.waitForTimeout(800);
}

/**
 * Vollständiger BMD-Upload-Ablauf (live verifiziert):
 *  Toolbar "Dateien hochladen" → Modal "Zusatzinformation" (Buchungsperiode + Beschreibung)
 *  → "Übernehmen" → Modal "Dateien hochladen": verstecktes input[type=file] per setInputFiles
 *  → "Dateien hochladen" (Modal-Button) → Bestätigung "Der Upload wurde fertiggestellt!".
 * Voraussetzung: der Ziel-Ordner ist bereits selektiert (selectFolder).
 */
async function uploadViaModal(page: Page, localPath: string, desc: string, periodMY: string): Promise<boolean> {
  await page.getByText("Dateien hochladen", { exact: false }).first().click(); // Toolbar
  await page.getByText("Zusatzinformation", { exact: false }).first().waitFor({ timeout: 10000 });
  if (periodMY) {
    // Buchungsperiode best effort (Default = aktuelle Periode; Beschreibung trägt den Monat ohnehin).
    await page.locator('input[id*="AttrFieldCmbField"]').first().fill(periodMY).catch(() => {});
  }
  await page.locator('input[id*="AttrFieldTextField"]').first().fill(desc);
  await page.getByText("Übernehmen", { exact: true }).first().click();
  await page.waitForSelector("input[type=file]", { state: "attached", timeout: 10000 });
  await page.setInputFiles("input[type=file]", localPath);
  await page.waitForTimeout(1500);
  await page.getByText("Dateien hochladen", { exact: false }).last().click(); // Modal-Button
  return Promise.race([
    page.getByText(/Upload wurde fertiggestellt/i).first().waitFor({ timeout: 35000 }).then(() => true),
    page.getByText(desc, { exact: false }).first().waitFor({ timeout: 35000 }).then(() => true),
  ]).catch(() => false);
}

async function downloadPdf(b: Beleg): Promise<string> {
  if (!b.storagePath) throw new Error("kein storagePath");
  const url = await signedUrl(b.storagePath, 600);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF-Download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `bmd-${b.id}-${(b.fileName || "beleg.pdf").replace(/[^\w.\-]+/g, "_")}`);
  await fs.writeFile(tmp, buf);
  return tmp;
}

async function main(): Promise<void> {
  const [url, customer, user, pass] = await Promise.all([
    getConfig("BMD_PORTAL_URL"),
    getConfig("BMD_PORTAL_CUSTOMER"),
    getConfig("BMD_PORTAL_USER"),
    getConfig("BMD_PORTAL_PASSWORD"),
  ]);
  if (!url || !user || !pass) throw new Error("BMD-Zugang fehlt (BMD_PORTAL_URL/USER/PASSWORD).");

  const queued = await prisma.beleg.findMany({ where: { status: "queued" }, orderBy: { approvedAt: "asc" }, take: MAX_PER_RUN });
  if (!queued.length) {
    console.log("Nichts zu tun – keine freigegebenen Belege (status=queued).");
    await prisma.$disconnect();
    return;
  }
  console.log(`${queued.length} Beleg(e) zum Hochladen.`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await (await browser.newContext({ locale: "de-AT", acceptDownloads: true })).newPage();
  let loggedIn = false;

  for (const b of queued) {
    // Atomic claim – nur ein Lauf gewinnt.
    const claim = await prisma.beleg.updateMany({
      where: { id: b.id, status: "queued" },
      data: { status: "uploading", taskStartedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;

    let tmp = "";
    try {
      tmp = await downloadPdf(b);
      if (!loggedIn) {
        await login(page, url, customer || user, user, pass);
        await openUploader(page);
        loggedIn = true;
      }
      const folder = await folderForBeleg(b);
      const desc = descriptionFor(b);
      await selectFolder(page, folder);
      const ok = await uploadViaModal(page, tmp, desc, periodLong(b.periodMonth));
      if (!ok) throw new Error("Upload nicht bestätigt");

      await prisma.beleg.update({
        where: { id: b.id },
        data: {
          status: "uploaded",
          bmdUploadedAt: new Date(),
          confirmation: `${folder === "kreditkarte" ? "KK Kreditkarte" : "ER Eingangsrechnungen"} · ${desc}`,
          bmdError: null,
        },
      });
      console.log(`  ✅ ${b.vendor} → ${folder} · "${desc}"`);
    } catch (e) {
      await prisma.beleg.update({ where: { id: b.id }, data: { status: "failed", bmdError: (e as Error).message } });
      console.log(`  ⚠️ ${b.vendor}: ${(e as Error).message}`);
    } finally {
      if (tmp) await fs.unlink(tmp).catch(() => {});
    }
  }

  await browser.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("RUNNER-FEHLER:", e.message);
  process.exit(1);
});
