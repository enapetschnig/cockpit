/**
 * Einmaliges Seed für die Werbeanzeigen: setzt ADS_TOKEN_KEY (falls noch nicht da)
 * und legt die beiden bekannten Meta-Werbekonten verschlüsselt an + synct sie.
 *
 * Liest die Tokens aus den .env-Profilen im Ordner "New project".
 * Aufruf:  npx tsx prisma/seedAds.ts
 *
 * Idempotent: bei erneutem Lauf werden Token/Stammdaten aktualisiert (kein Duplikat).
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { encryptToken } from "../src/lib/adsCrypto";
import { clearConfigCache } from "../src/lib/config";
import { testConnection, syncCampaigns } from "../src/lib/meta";

const prisma = new PrismaClient();

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const PROFILES = [
  { label: "Christoph Werbung", file: ".env.christoph-werbung" },
  { label: "ET König Werbung", file: ".env.meta-new" },
];

async function main() {
  // 1) Token-Schlüssel sicherstellen
  let key = await prisma.setting.findUnique({ where: { key: "ADS_TOKEN_KEY" } });
  if (!key?.value) {
    const generated = randomBytes(32).toString("hex");
    key = await prisma.setting.upsert({
      where: { key: "ADS_TOKEN_KEY" },
      create: { key: "ADS_TOKEN_KEY", value: generated },
      update: { value: generated },
    });
    console.log("ADS_TOKEN_KEY neu generiert und gespeichert.");
  } else {
    console.log("ADS_TOKEN_KEY existiert bereits.");
  }
  clearConfigCache();

  const root = process.cwd();
  for (const p of PROFILES) {
    const env = readEnv(join(root, "New project", p.file));
    const token = env.ACCESS_TOKEN;
    const metaAccountId = env.AD_ACCOUNT_ID;
    if (!token || token.includes("PLACEHOLDER") || !metaAccountId) {
      console.log(`Übersprungen: ${p.label} (kein gültiges Profil in ${p.file}).`);
      continue;
    }

    let info: { name?: string; currency?: string; timezone?: string } = {};
    try {
      info = await testConnection(token, metaAccountId);
    } catch (e) {
      console.log(`⚠️  ${p.label}: Verbindungstest fehlgeschlagen – ${(e as Error).message}`);
    }

    const cipher = await encryptToken(token);
    const acc = await prisma.adAccount.upsert({
      where: { metaAccountId },
      create: {
        label: p.label,
        metaAccountId,
        accountName: info.name ?? null,
        currency: info.currency ?? null,
        timezoneName: info.timezone ?? null,
        tokenCipher: cipher,
        status: info.name ? "connected" : "not_connected",
      },
      update: {
        label: p.label,
        accountName: info.name ?? undefined,
        currency: info.currency ?? undefined,
        timezoneName: info.timezone ?? undefined,
        tokenCipher: cipher,
        status: info.name ? "connected" : undefined,
        lastError: null,
      },
    });

    try {
      const r = await syncCampaigns(acc.id);
      console.log(`✓ ${p.label} (${metaAccountId}) – ${r.count} Kampagnen geladen.`);
    } catch (e) {
      console.log(`✓ ${p.label} (${metaAccountId}) angelegt – Sync später: ${(e as Error).message}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
