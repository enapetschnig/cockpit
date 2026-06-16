/**
 * Verschlüsselung der Meta-Access-Tokens (AES-256-GCM, Node `crypto`).
 * Der Schlüssel kommt aus der Config (Setting/Env) `ADS_TOKEN_KEY` – beliebiger
 * String, wird per SHA-256 auf 32 Byte abgebildet. Format: base64(iv[12] | tag[16] | cipher).
 *
 * Bewusst NICHT das selbstgebaute XOR der alten Flask-App – echtes AEAD.
 * Hinweis: Schlüssel-Rotation macht alte Cipher unlesbar → dann Konten neu verbinden.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getConfig } from "./config";

async function keyBytes(): Promise<Buffer> {
  const secret = (await getConfig("ADS_TOKEN_KEY")) || "";
  if (!secret) throw new Error("ADS_TOKEN_KEY fehlt (unter /connect → Einstellungen setzen).");
  return createHash("sha256").update(secret, "utf8").digest(); // 32 Byte
}

export async function encryptToken(plain: string): Promise<string> {
  const key = await keyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export async function decryptToken(packed: string): Promise<string> {
  const key = await keyBytes();
  const raw = Buffer.from(packed, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Ob ein Verschlüsselungs-Key konfiguriert ist (für sanftes Degradieren in der UI). */
export async function hasTokenKey(): Promise<boolean> {
  return Boolean((await getConfig("ADS_TOKEN_KEY")) || "");
}
