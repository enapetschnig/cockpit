/**
 * Verschlüsselt die Geheimnisse in der Cockpit-DB (Schema cockpit) an Ort und Stelle:
 *   - Setting-Werte der geheimen Keys (GEHEIME_KEYS aus src/lib/config.ts)
 *   - GmailAccount.refreshToken
 * Format und Schlüssel kommen aus src/lib/geheimnis.ts – exakt wie in der App, beide können nicht auseinanderlaufen.
 * Ausgegeben werden nur Keys/Konten und ihr Zustand, NIE Werte.
 *
 *   npx tsx scripts/geheimnisse-verschluesseln.ts                → Probelauf: zeigt, was verschlüsselt WÜRDE (liest nur)
 *   npx tsx scripts/geheimnisse-verschluesseln.ts --ausfuehren   → Klartext-Werte verschlüsseln (enc1:… wird übersprungen)
 *   npx tsx scripts/geheimnisse-verschluesseln.ts --rueckgaengig → alles zurück in Klartext (Notfall / Schlüsselwechsel)
 *
 * Im Repo-Root aufrufen: DATABASE_URL kommt aus der .env, COCKPIT_GEHEIMNIS_KEY aus der Umgebung (notfalls auch .env).
 * Es MUSS derselbe Schlüssel sein wie in der Vercel-Env – sonst kann die App ihre Keys nicht mehr lesen.
 * Idempotent; jede Zeile wird nur geändert, wenn sie seit dem Lesen unverändert ist (paralleles Speichern in der App).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { GEHEIME_KEYS } from "../src/lib/config";
import { entschluesseln, geheimnisKeyArt, istVerschluesselt, verschluesseln } from "../src/lib/geheimnis";

type Modus = "probe" | "ausfuehren" | "rueckgaengig";
type Art = "verschluesseln" | "entschluesseln" | "schon" | "bleibt" | "problem";

/** Geplanter Schritt – `neu` bleibt im Speicher, ausgegeben werden nur `wo` und `status`. */
interface Schritt {
  wo: string;
  art: Art;
  status: string;
  neu?: string;
  schreiben?: (neu: string) => Promise<boolean>;
}

function modusAusArgs(): Modus {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--ausfuehren" && a !== "--rueckgaengig")) {
    throw new Error("Unbekannte Option – erlaubt sind nur --ausfuehren oder --rueckgaengig (ohne = Probelauf).");
  }
  const aus = args.includes("--ausfuehren");
  const rueck = args.includes("--rueckgaengig");
  if (aus && rueck) throw new Error("Bitte nur eins: --ausfuehren ODER --rueckgaengig.");
  return aus ? "ausfuehren" : rueck ? "rueckgaengig" : "probe";
}

/** Was mit einem gespeicherten Wert passiert – ohne ihn je auszugeben. */
function planen(modus: Modus, wert: string, geheim: boolean): Pick<Schritt, "art" | "status" | "neu"> {
  if (istVerschluesselt(wert)) {
    if (!geheimnisKeyArt()) {
      return modus === "rueckgaengig"
        ? { art: "problem", status: "verschlüsselt – ohne Schlüssel nicht lesbar" }
        : { art: "schon", status: "bereits verschlüsselt (ohne Schlüssel nicht geprüft)" };
    }
    let klar: string;
    try {
      klar = entschluesseln(wert);
    } catch {
      return { art: "problem", status: "verschlüsselt, aber mit DIESEM Schlüssel nicht lesbar ✗" };
    }
    if (modus === "rueckgaengig") return { art: "entschluesseln", status: "verschlüsselt → wird Klartext", neu: klar };
    return { art: "schon", status: "bereits verschlüsselt, mit diesem Schlüssel lesbar ✓" };
  }
  if (!geheim || modus === "rueckgaengig") return { art: "bleibt", status: "Klartext – bleibt" };
  if (modus === "probe") return { art: "verschluesseln", status: "Klartext → würde verschlüsselt" };
  const neu = verschluesseln(wert);
  // Gegenprobe vor dem Schreiben: muss Chiffrat sein und exakt zum alten Wert zurückführen
  if (!istVerschluesselt(neu) || entschluesseln(neu) !== wert) return { art: "problem", status: "Gegenprobe fehlgeschlagen – bleibt" };
  return { art: "verschluesseln", status: "Klartext → wird verschlüsselt", neu };
}

async function main(): Promise<void> {
  const envDatei = path.join(process.cwd(), ".env");
  if (fs.existsSync(envDatei)) process.loadEnvFile(envDatei); // überschreibt nichts, was schon in der Umgebung steht
  const modus = modusAusArgs();
  const keyArt = geheimnisKeyArt();

  const titel = { probe: "Probelauf (schreibt nichts)", ausfuehren: "VERSCHLÜSSELN", rueckgaengig: "ZURÜCK IN KLARTEXT" }[modus];
  console.log(`Geheimnisse in der Cockpit-DB – ${titel}`);
  console.log(`COCKPIT_GEHEIMNIS_KEY: ${keyArt === "base64" ? "gesetzt (base64, 32 Byte)" : keyArt === "passphrase" ? "gesetzt (Passphrase → SHA-256)" : "FEHLT"}\n`);
  if (!keyArt && modus !== "probe") throw new Error("COCKPIT_GEHEIMNIS_KEY fehlt – ohne Schlüssel wird nichts geschrieben.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt (Skript im Repo-Root aufrufen, .env dort?).");

  const geheim = new Set<string>(GEHEIME_KEYS);
  const schritte: Schritt[] = [];

  // Setting: geheime Keys; beim Zurückdrehen zusätzlich jeder andere enc1:-Wert
  const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  const nichtGeheim: string[] = [];
  for (const s of settings) {
    if (!geheim.has(s.key) && !istVerschluesselt(s.value)) {
      nichtGeheim.push(s.key);
      continue;
    }
    const alt = s.value;
    schritte.push({
      wo: `Setting ${s.key}`,
      ...planen(modus, alt, geheim.has(s.key)),
      schreiben: async (neu) => (await prisma.setting.updateMany({ where: { key: s.key, value: alt }, data: { value: neu } })).count === 1,
    });
  }
  const ohneDbEintrag = GEHEIME_KEYS.filter((k) => !settings.some((s) => s.key === k));

  // GmailAccount.refreshToken: immer geheim
  const konten = await prisma.gmailAccount.findMany({ select: { id: true, account: true, refreshToken: true }, orderBy: { account: "asc" } });
  for (const k of konten) {
    const alt = k.refreshToken;
    if (!alt) {
      schritte.push({ wo: `GmailAccount ${k.account}`, art: "bleibt", status: "kein Refresh-Token – nichts zu tun" });
      continue;
    }
    schritte.push({
      wo: `GmailAccount ${k.account}`,
      ...planen(modus, alt, true),
      schreiben: async (neu) => (await prisma.gmailAccount.updateMany({ where: { id: k.id, refreshToken: alt }, data: { refreshToken: neu } })).count === 1,
    });
  }

  const zaehler: Record<Art, number> = { verschluesseln: 0, entschluesseln: 0, schon: 0, bleibt: 0, problem: 0 };
  const breite = Math.max(10, ...schritte.map((s) => s.wo.length));
  for (const s of schritte) {
    let { art, status } = s;
    if (modus !== "probe" && s.neu !== undefined && s.schreiben) {
      try {
        if (await s.schreiben(s.neu)) {
          status += " ✓";
        } else {
          art = "problem";
          status += " – übersprungen: Wert wurde inzwischen geändert (einfach nochmal laufen lassen)";
        }
      } catch (e) {
        // Prisma-Meldungen können die Abfrage-Argumente (= Werte) enthalten → nur Code/Name ausgeben
        art = "problem";
        status += ` – Schreibfehler (${(e as { code?: string }).code ?? (e as Error).name})`;
      }
    }
    zaehler[art]++;
    console.log(`  ${s.wo.padEnd(breite)}  ${status}`);
  }
  if (nichtGeheim.length) console.log(`\n  nicht geheim, bleibt Klartext: ${nichtGeheim.join(", ")}`);
  if (ohneDbEintrag.length) console.log(`  geheime Keys ohne DB-Eintrag (ggf. nur Env): ${ohneDbEintrag.join(", ")}`);

  const z = zaehler;
  if (modus === "probe") {
    console.log(`\nErgebnis: ${z.verschluesseln} würden verschlüsselt, ${z.schon} bereits verschlüsselt, ${z.problem} Probleme.`);
    console.log("Ausführen: COCKPIT_GEHEIMNIS_KEY='<derselbe wie in Vercel>' npx tsx scripts/geheimnisse-verschluesseln.ts --ausfuehren");
  } else if (modus === "ausfuehren") {
    console.log(`\nErgebnis: ${z.verschluesseln} verschlüsselt, ${z.schon} waren schon verschlüsselt, ${z.problem} Probleme.`);
  } else {
    console.log(`\nErgebnis: ${z.entschluesseln} zurück in Klartext, ${z.problem} Probleme.`);
  }
  if (z.problem) process.exitCode = 1;
}

main()
  .catch((e) => {
    // Eigene Meldungen sind wertfrei; Lese-Fehler von Prisma enthalten hier keine Werte (Abfragen ohne Werte-Filter)
    console.error("Abbruch:", (e as Error).message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
