import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signedUrl } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** "PDF ansehen": leitet auf eine frische, kurzlebige Signed-URL um (Bucket bleibt privat). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const beleg = await prisma.beleg.findUnique({ where: { id } });
  if (!beleg?.storagePath) return NextResponse.json({ error: "Datei nicht gefunden" }, { status: 404 });
  try {
    const url = await signedUrl(beleg.storagePath, 300);
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
