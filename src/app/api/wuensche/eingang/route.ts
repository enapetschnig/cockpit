/**
 * Eingang für Änderungswünsche aus den Handwerker-Apps.
 *
 * Öffentlich erreichbar (die Apps rufen per Datenbank-Trigger auf), aber nur
 * mit dem gemeinsamen Geheimnis im Header `x-cockpit-secret`. Die App ist die
 * Wahrheit: jeder Aufruf überschreibt den Datensatz komplett – nur `gesehenAm`
 * und `customerId` bleiben unangetastet, das sind cockpit-eigene Vermerke.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendTelegram } from "@/lib/telegram";
import { appLabel, secretGleich } from "@/lib/apps";

export const dynamic = "force-dynamic";

interface Payload {
  id?: string;
  art?: string;
  status?: string;
  text?: string;
  antwort?: string | null;
  seite?: string | null;
  bild_pfad?: string | null;
  audio_pfad?: string | null;
  melder?: string | null;
  erstellt_am?: string;
  aktualisiert_am?: string;
}

const str = (v: unknown): string | null => {
  const s = (v ?? "").toString().trim();
  return s ? s : null;
};
const datum = (v: unknown): Date => {
  const d = new Date((v ?? "").toString());
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

const ART_LABEL: Record<string, string> = { wunsch: "Wunsch", fehler: "Fehler", frage: "Frage" };

export async function POST(req: Request) {
  const secret = process.env.FEEDBACK_SHARED_SECRET;
  const mitgeschickt = req.headers.get("x-cockpit-secret") ?? "";
  if (!secret || !secretGleich(mitgeschickt, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const appKey = (req.headers.get("x-app-key") ?? "").trim();
  if (!appKey) return NextResponse.json({ error: "x-app-key fehlt" }, { status: 400 });

  const b = (await req.json().catch(() => ({}))) as Payload;
  const id = str(b.id);
  const text = str(b.text);
  if (!id || !text) return NextResponse.json({ error: "id und text nötig" }, { status: 400 });

  const gemeinsam = {
    appKey,
    art: str(b.art) ?? "wunsch",
    status: str(b.status) ?? "neu",
    text,
    antwort: str(b.antwort),
    seite: str(b.seite),
    melder: str(b.melder),
    bildPfad: str(b.bild_pfad),
    audioPfad: str(b.audio_pfad),
    erstelltAm: datum(b.erstellt_am),
    aktualisiert: datum(b.aktualisiert_am ?? b.erstellt_am),
  };

  const vorhanden = await prisma.appWunsch.findUnique({ where: { id }, select: { id: true } });

  if (vorhanden) {
    // Update: customerId und gesehenAm bleiben, wie sie sind.
    await prisma.appWunsch.update({ where: { id }, data: gemeinsam });
  } else {
    // Erster Eingang: Kunde einmalig über den appKey zuordnen.
    const kunde = await prisma.customer.findUnique({ where: { appKey }, select: { id: true } });
    await prisma.appWunsch.create({ data: { id, ...gemeinsam, customerId: kunde?.id ?? null } });

    // Push nur beim erstmaligen Eingang mit Status "neu" – Updates pingen nicht.
    if (gemeinsam.status === "neu") {
      const anfang = text.length > 160 ? text.slice(0, 160) + " …" : text;
      const art = ART_LABEL[gemeinsam.art] ?? gemeinsam.art;
      await sendTelegram(`🛠 ${appLabel(appKey)}: ${art} — ${anfang}`).catch(() => {});
    }
  }

  // Der Trigger wertet die Antwort nicht aus – immer 200.
  return NextResponse.json({ ok: true });
}
