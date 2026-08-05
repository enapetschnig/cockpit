import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendMailWithPdf } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Die CRM-App (app.epowergmbh.at) darf hier Belege verschicken.
const ALLOWED = new Set([
  "https://app.epowergmbh.at",
  "https://epower-crm.vercel.app",
  "http://localhost:5173",
  "http://localhost:8080",
]);

function cors(origin: string | null): Record<string, string> {
  const o = origin && ALLOWED.has(origin) ? origin : "https://app.epowergmbh.at";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

// POST { to, subject, text, fileName?, pdfBase64? } – Auth via Supabase-Access-Token
export async function POST(req: Request) {
  const h = cors(req.headers.get("origin"));
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, error: "Nicht angemeldet" }, { status: 401, headers: h });

  // Token gegen dasselbe Supabase-Projekt prüfen
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ ok: false, error: "Supabase nicht konfiguriert" }, { status: 500, headers: h });
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return NextResponse.json({ ok: false, error: "Ungültige Sitzung" }, { status: 401, headers: h });

  const b = (await req.json().catch(() => ({}))) as {
    to?: string; subject?: string; text?: string; fileName?: string; pdfBase64?: string;
  };
  const to = (b.to ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ ok: false, error: "Ungültige E-Mail-Adresse" }, { status: 400, headers: h });
  }
  if (b.pdfBase64 && b.pdfBase64.length > 12_000_000) {
    return NextResponse.json({ ok: false, error: "Anhang zu groß" }, { status: 400, headers: h });
  }

  try {
    const res = await sendMailWithPdf({
      to,
      subject: (b.subject ?? "Beleg").slice(0, 200),
      body: b.text ?? "",
      fileName: b.fileName,
      pdfBase64: b.pdfBase64,
    });
    return NextResponse.json({ ok: true, to: res.to }, { headers: h });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200, headers: h },
    );
  }
}
