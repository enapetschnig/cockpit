import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendTelegram } from "@/lib/telegram";
import { besprechungMeldung } from "@/lib/besprechungen";
import { esc, karteFuer, kundenNamen, ladeAuftrag, meldungFuerAuftrag, ohneMarkdown, wunschMeldung, type Auftrag } from "@/lib/roboter";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Einmal-Marken für Meldungen ohne eigene „gemeldet“-Spalte (Wunsch, Plaud) – in der Setting-Tabelle,
// der Primärschlüssel macht das Beanspruchen atomar. Nach 2 Tagen aufgeräumt (Wünsche zählen nur 30 Min).
const MARKE = "GEMELDET:";

/** true = dieser Aufruf hat die Marke gesetzt und darf melden; false = schon gemeldet. */
async function beanspruchen(key: string): Promise<boolean> {
  await prisma.setting.deleteMany({ where: { key: { startsWith: MARKE }, updatedAt: { lt: new Date(Date.now() - 2 * 86400_000) } } });
  try {
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

/** Nicht angekommen → Marke wieder freigeben, damit ein erneuter Aufruf meldet. */
const freigeben = (key: string) => prisma.setting.deleteMany({ where: { key } }).catch(() => {});

/**
 * Telegram-Meldungen des Änderungswunsch-Roboters (läuft am PC, öffentlich erreichbar).
 *
 * Der Roboter schickt nur eine ID ({id} = Auftrag, {frage} = beantwortete Frage).
 * Text, Knöpfe und Empfänger baut das Cockpit selbst aus der Datenbank – so braucht
 * der PC den Telegram-Schlüssel nicht, und niemand kann über diesen Weg beliebige
 * Texte verschicken. Jede Stufe geht genau einmal raus, nur frische Stände.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string; frage?: string; wunsch?: string; besprechung?: string; plaud?: string };

  // Neue Besprechung aus Plaud (PC, werkzeuge/plaud): „🎙 … abgelegt“ bzw. „❓ zu wem gehört die?“ – genau einmal.
  if (b.besprechung && UUID.test(b.besprechung)) {
    const k = await besprechungMeldung(b.besprechung);
    if (!k) return NextResponse.json({ ok: true, nichts: true });
    const r = await sendTelegram(k.text, k.buttons.length ? { buttons: k.buttons } : undefined);
    if (!r.ok) {
      await prisma.$executeRaw`update crm.besprechungen set gemeldet = null where id = ${b.besprechung}::uuid`;
      return NextResponse.json({ ok: false }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }
  // Plaud-Anmeldung am PC abgelaufen (höchstens einmal am Tag vom PC gemeldet) – fester Text.
  // Auch hier höchstens einmal am Tag (Wiener Datum) – der Endpunkt ist öffentlich.
  if (b.plaud === "anmeldung") {
    const key = MARKE + "plaud:" + new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(new Date());
    if (!(await beanspruchen(key))) return NextResponse.json({ ok: true, schon: true });
    const r = await sendTelegram("⚠️ Plaud: die Anmeldung am PC ist abgelaufen – Besprechungen kommen gerade nicht ins CRM. Sag mir kurz Bescheid, dann melde ich dich neu an.");
    if (!r.ok) await freigeben(key);
    return NextResponse.json({ ok: true });
  }

  // Neuer Wunsch aus einer Kunden-App (CRM-Eingang): „Soll ich das umsetzen?“ – Text baut das Cockpit aus der Datenbank.
  // Jeder Wunsch genau einmal – sonst könnte jeder, der eine Wunsch-ID kennt, 30 Minuten lang Telegrams auslösen.
  if (typeof b.wunsch === "string" && b.wunsch.length <= 80) {
    const k = await wunschMeldung(b.wunsch);
    if (!k) return NextResponse.json({ ok: true, nichts: true });
    // Erst prüfen, ob es den frischen Wunsch gibt, dann beanspruchen – fremde IDs legen keine Marken an.
    const key = MARKE + "wunsch:" + b.wunsch;
    if (!(await beanspruchen(key))) return NextResponse.json({ ok: true, schon: true });
    const r = await sendTelegram(k.text, k.buttons.length ? { buttons: k.buttons } : undefined);
    if (!r.ok) {
      await freigeben(key);
      return NextResponse.json({ ok: false }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

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
