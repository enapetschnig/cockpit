/**
 * Verschlüsselung von Geheimnissen in der DB (Setting-Werte, Gmail-Refresh-Tokens) – AES-256-GCM.
 *
 * Der Schlüssel kommt AUSSCHLIESSLICH aus der Env-Var COCKPIT_GEHEIMNIS_KEY (Vercel-Env bzw. lokale .env),
 * nie aus der DB/getConfig – sonst läge er direkt neben den Daten, die er schützen soll.
 *   - base64 von genau 32 Byte (empfohlen: `openssl rand -base64 32`) → direkt als Schlüssel
 *   - jeder andere String → per SHA-256 auf 32 Byte abgebildet
 * Format: "enc1:" + base64(iv[12] | tag[16] | cipher)
 *
 * Übergang: Fehlt der Env-Key, speichert verschluesseln() weiter Klartext (einmalige Warnung) – Code kann
 * also vor der Env-Var deployt werden. entschluesseln() reicht Klartext (ohne "enc1:") unverändert durch.
 * App UND scripts/geheimnisse-verschluesseln.ts nutzen dieses Modul – Format und Schlüssel laufen nie auseinander.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PRAEFIX = "enc1:";
let gewarnt = false;

function rohKey(): string {
  return process.env.COCKPIT_GEHEIMNIS_KEY?.trim() || "";
}

/** Kanonisches base64 von genau 32 Byte → direkt der Schlüssel; sonst null (= Passphrase). */
function alsBase64Key(roh: string): Buffer | null {
  const b = Buffer.from(roh, "base64");
  return b.length === 32 && b.toString("base64") === roh ? b : null;
}

/** 32-Byte-Schlüssel aus der Umgebung – oder null, wenn COCKPIT_GEHEIMNIS_KEY nicht gesetzt ist. */
function schluessel(): Buffer | null {
  const roh = rohKey();
  if (!roh) return null;
  return alsBase64Key(roh) ?? createHash("sha256").update(roh, "utf8").digest();
}

/** Wie COCKPIT_GEHEIMNIS_KEY gelesen wird: "base64" (32 Byte direkt), "passphrase" (SHA-256) oder null (fehlt). */
export function geheimnisKeyArt(): "base64" | "passphrase" | null {
  const roh = rohKey();
  if (!roh) return null;
  return alsBase64Key(roh) ? "base64" : "passphrase";
}

/** Ob ein gespeicherter Wert schon verschlüsselt ist ("enc1:…"). */
export function istVerschluesselt(wert: string | null | undefined): boolean {
  return typeof wert === "string" && wert.startsWith(PRAEFIX);
}

/** Klartext → "enc1:…". Ohne COCKPIT_GEHEIMNIS_KEY: Klartext unverändert zurück (einmalige Warnung). */
export function verschluesseln(klartext: string): string {
  if (istVerschluesselt(klartext)) return klartext; // nie doppelt verschlüsseln
  const key = schluessel();
  if (!key) {
    if (!gewarnt) {
      gewarnt = true;
      console.warn("[geheimnis] COCKPIT_GEHEIMNIS_KEY fehlt – Geheimnisse werden vorerst im Klartext gespeichert.");
    }
    return klartext;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const enc = Buffer.concat([cipher.update(klartext, "utf8"), cipher.final()]);
  return PRAEFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/** "enc1:…" → Klartext. Klartext-Altbestand geht unverändert durch; fehlender/falscher Schlüssel → klarer Fehler. */
export function entschluesseln(wert: string): string {
  if (!istVerschluesselt(wert)) return wert;
  const key = schluessel();
  if (!key) {
    throw new Error("Verschlüsselter Wert in der DB, aber COCKPIT_GEHEIMNIS_KEY fehlt in der Umgebung (Vercel-Env bzw. .env setzen).");
  }
  const raw = Buffer.from(wert.slice(PRAEFIX.length), "base64");
  if (raw.length < 12 + 16) throw new Error("Verschlüsselter Wert ist beschädigt (zu kurz).");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12), { authTagLength: 16 });
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Entschlüsseln fehlgeschlagen – COCKPIT_GEHEIMNIS_KEY passt nicht zum gespeicherten Wert (oder der Wert ist beschädigt).");
  }
}
