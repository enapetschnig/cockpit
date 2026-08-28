/**
 * Datei-Proxy für Screenshots und Sprachnachrichten.
 *
 * Die Dateien bleiben im privaten Bucket der jeweiligen App. Das Cockpit holt
 * sich bei der App-eigenen Edge Function `wunsch-datei` eine signierte URL
 * (1 Stunde gültig) und leitet dorthin weiter – abgesichert über dasselbe
 * gemeinsame Geheimnis wie der Eingang.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appInfo } from "@/lib/apps";
import { getSessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const art = new URL(req.url).searchParams.get("art") === "audio" ? "audio" : "bild";

  const w = await prisma.appWunsch.findUnique({
    where: { id },
    select: { appKey: true, bildPfad: true, audioPfad: true },
  });
  if (!w) return NextResponse.json({ error: "nicht gefunden" }, { status: 404 });

  const pfad = art === "audio" ? w.audioPfad : w.bildPfad;
  if (!pfad) return NextResponse.json({ error: "keine Datei hinterlegt" }, { status: 404 });

  const app = appInfo(w.appKey);
  if (!app) return NextResponse.json({ error: `App "${w.appKey}" ist im Cockpit nicht hinterlegt` }, { status: 400 });

  const secret = process.env.FEEDBACK_SHARED_SECRET;
  if (!secret) return NextResponse.json({ error: "FEEDBACK_SHARED_SECRET fehlt" }, { status: 500 });

  try {
    const res = await fetch(`https://${app.projectRef}.supabase.co/functions/v1/wunsch-datei`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cockpit-secret": secret },
      body: JSON.stringify({ pfad }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `App antwortet ${res.status}` }, { status: 502 });
    }
    const { url } = (await res.json()) as { url?: string };
    if (!url) return NextResponse.json({ error: "App lieferte keine URL" }, { status: 502 });
    return NextResponse.redirect(url, 307);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "App nicht erreichbar" }, { status: 502 });
  }
}
