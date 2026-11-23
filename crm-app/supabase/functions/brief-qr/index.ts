/**
 * QR-Code aus einem Brief wurde gescannt (Schema `crm`, Tabellen brief_qr / brief_qr_scans).
 *
 * Aufruf nur von der Website (api/q.js, epowergmbh.at/q/<code>), abgesichert über den Header
 * `x-webhook-key` = Secret WEBHOOK_API_KEY (dasselbe wie import-lead).
 * Body: { code, user_agent } → speichert den Scan und liefert { kampagne } für den Weiterleitungs-Link.
 * Unbekannte Codes werden trotzdem gespeichert (kampagne leer), damit nichts verloren geht.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const cut = (v: unknown, n: number): string => (v ?? "").toString().trim().slice(0, n);

/** Link-Vorschauen und Crawler zählen nicht als echter Scan. */
const BOT = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|telegram|curl|wget|python|headless/i;

function geraet(ua: string): string {
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? "Android-Handy" : "Android-Tablet";
  if (/windows|macintosh|linux/i.test(ua)) return "PC";
  return "unbekannt";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "nur POST" }, 405);
  const expected = Deno.env.get("WEBHOOK_API_KEY");
  if (!expected || req.headers.get("x-webhook-key") !== expected) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Body ist kein gültiges JSON" }, 400); }
  const code = cut(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ua = cut(body.user_agent, 400);
  if (!code) return json({ error: "code fehlt" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "crm" }, auth: { persistSession: false },
  });

  const { data: qr } = await supabase.from("brief_qr").select("kampagne").eq("code", code).maybeSingle();
  const kampagne = qr?.kampagne ?? null;
  const { error } = await supabase.from("brief_qr_scans").insert({
    code, kampagne, user_agent: ua || null, geraet: geraet(ua), bot: BOT.test(ua),
  });
  if (error) console.error("Scan nicht gespeichert:", error.message);
  return json({ ok: !error, kampagne });
});
