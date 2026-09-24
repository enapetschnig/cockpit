import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendTelegram } from "@/lib/telegram";
import { esc, karteFuer, kundenNamen, ladeAuftrag, meldungFuerAuftrag, ohneMarkdown, type Auftrag } from "@/lib/roboter";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Telegram-Meldungen des Änderungswunsch-Roboters (läuft am PC, öffentlich erreichbar).
 *
 * Der Roboter schickt nur eine ID ({id} = Auftrag, {frage} = beantwortete Frage).
 * Text, Knöpfe und Empfänger baut das Cockpit selbst aus der Datenbank – so braucht
 * der PC den Telegram-Schlüssel nicht, und niemand kann über diesen Weg beliebige
 * Texte verschicken. Jede Stufe geht genau einmal raus, nur frische Stände.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string; frage?: string };

  if (b.frage && UUID.test(b.frage)) {
    // Erst beanspruchen, dann senden – doppelte Aufrufe schicken nichts doppelt.
    const [f] = await prisma.$queryRaw<{ app_key: string; auftrag_id: string | null; frage: string; antwort: string | null; status: string }[]>`
      update crm.roboter_fragen set gemeldet = true
      where id = ${b.frage}::uuid and not gemeldet and status in ('beantwortet', 'fehler') and beantwortet_am > now() - interval '15 minutes'
      returning app_key, auftrag_id::text as auftrag_id, frage, antwort, status`;
    if (!f) return NextResponse.json({ ok: true, nichts: true });
    const kunde = (await kundenNamen()).get(f.app_key) ?? f.app_key;
    const a = f.auftrag_id ? await ladeAuftrag(f.auftrag_id) : null;
    const antwort = f.status === "fehler" ? `⚠️ Da kam ich nicht weiter: ${f.antwort || "unbekannter Fehler"}` : ohneMarkdown(f.antwort || "");
    // Unter der Antwort die Knöpfe des Auftrags, damit man gleich freigeben/ändern kann.
    const knoepfe = a && ["vorschlag", "wartet", "fehler", "vorschau", "db_freigabe"].includes(a.status) ? (await karteFuer(a)).buttons : undefined;
    // Wie eine Chat-Nachricht vom Roboter. Unten „Auftrag …“/„Projekt …“: darüber landet eine Antwort
    // darauf wieder beim richtigen Roboter (Webhook).
    const r = await sendTelegram(
      `🤖 <b>Roboter · ${esc(kunde)}</b>\n${esc(antwort)}\n<i>${a ? `Auftrag ${a.id.slice(0, 8)}` : `Projekt ${esc(f.app_key)}`}</i>`,
      knoepfe ? { buttons: knoepfe } : undefined
    );
    if (!r.ok) {
      await prisma.$executeRaw`update crm.roboter_fragen set gemeldet = false where id = ${b.frage}::uuid`;
      return NextResponse.json({ ok: false, error: "Telegram nicht erreicht" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!b.id || !UUID.test(b.id)) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const [beansprucht] = await prisma.$queryRaw<{ id: string }[]>`
    update crm.roboter_auftraege set gemeldet = status
    where id = ${b.id}::uuid and gemeldet is distinct from status and aktualisiert > now() - interval '1 day'
      and status in ('vorschlag', 'vorschau', 'erledigt', 'wartet', 'fehler', 'db_freigabe')
    returning id::text as id`;
  if (!beansprucht) return NextResponse.json({ ok: true, schon: true });
  const a = (await ladeAuftrag(beansprucht.id)) as Auftrag;
  const m = await meldungFuerAuftrag(a);
  if (m) {
    const r = await sendTelegram(m.text, { ...(m.buttons.length ? { buttons: m.buttons } : {}), leise: !!m.leise });
    // Nicht angekommen → Stufe wieder freigeben, damit ein erneuter Aufruf sie meldet.
    if (!r.ok) {
      await prisma.$executeRaw`update crm.roboter_auftraege set gemeldet = null where id = ${a.id}::uuid and gemeldet = ${a.status}`;
      return NextResponse.json({ ok: false, error: "Telegram nicht erreicht" }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true });
}
