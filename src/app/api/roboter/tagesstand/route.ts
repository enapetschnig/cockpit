import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendTelegram } from "@/lib/telegram";
import { aktiveAuftraege, esc, kuerzen, kundenNamen, offeneWuensche, ohneMarkdown, type Knopf } from "@/lib/roboter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tagesstand des Roboters + Wachhund (02.11.2026, Christoph: „in der Früh um 7 Uhr weiß, muss ich wo handeln, und am
 * Abend nochmal … zwischendrin wirklich nur die Notfälle“).
 *
 * Vercel-Cron alle 10 Min (vercel.json):
 *  - um 7:00 und 18:00 (Wien) genau eine Nachricht: nur was Christoph tun muss, darunter eine Zeile, was erledigt ist;
 *    montags früh die Wochenzahlen. Steht nichts an, kommt sie leise.
 *  - Wachhund: steht der Roboter (kein Puls seit 20 Min) und es liegt Arbeit da → sofort 🚨, höchstens alle 3 Std,
 *    nur zwischen 6 und 22 Uhr (nachts steht es dann im Tagesstand um 7).
 *  - Achtung (seit 04.11.2026): sofort, wenn Christoph handeln muss, etwas öfter danebengeht oder ein Kunde sauer
 *    klingt – siehe achtung().
 */
function cronErlaubt(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(req.headers.get("authorization") || ""), h(`Bearer ${secret}`));
}

const WARTET_AUF_DICH = ["vorschlag", "vorschau", "wartet", "fehler", "db_freigabe"];
const ZULETZT = "TAGESSTAND_ZULETZT";
const WACHHUND = "ROBOTER_STEHT_GEMELDET";

function wien(d = new Date()) {
  const t = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(d).map((p) => [p.type, p.value]),
  );
  return { tag: `${t.year}-${t.month}-${t.day}`, stunde: Number(t.hour), montag: t.weekday === "Mon" };
}

/** Einmal-Marke (Primärschlüssel macht es atomar). */
async function einmal(key: string): Promise<boolean> {
  try {
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

export async function GET(req: Request) {
  if (!cronErlaubt(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jetzt = wien();
  const ergebnis: Record<string, unknown> = { wachhund: await wachhund(jetzt.stunde), achtung: await achtung(jetzt.stunde) };
  // Zum Testen: ?jetzt=1 schickt den Tagesstand sofort (ohne Marke, ändert „zuletzt“ nicht).
  const probe = new URL(req.url).searchParams.get("jetzt") === "1";
  if (probe || jetzt.stunde === 7 || jetzt.stunde === 18) {
    const key = `TAGESSTAND:${jetzt.tag}:${jetzt.stunde}`;
    if (probe || (await einmal(key))) {
      const r = await tagesstand(jetzt.stunde < 12, jetzt.montag && jetzt.stunde < 12, probe);
      if (!r.ok && !probe) await prisma.setting.deleteMany({ where: { key } });
      ergebnis.tagesstand = r;
    }
  }
  // Alte Marken aufräumen.
  await prisma.setting.deleteMany({ where: { key: { startsWith: "TAGESSTAND:" }, updatedAt: { lt: new Date(Date.now() - 3 * 86400_000) } } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "ACHTUNG:" }, updatedAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
  return NextResponse.json(ergebnis);
}

async function wachhund(stunde: number) {
  const [p] = await prisma.$queryRaw<{ zuletzt: Date | null; meldung: string | null }[]>`select zuletzt, meldung from crm.roboter_puls where id = 1`;
  const minuten = p?.zuletzt ? Math.round((Date.now() - new Date(p.zuletzt).getTime()) / 60_000) : null;
  if (minuten === null || minuten < 20) return { ok: true, minuten };
  // Pause ist Absicht (z. B. eine andere Sitzung arbeitet am Projekt) – der Roboter pulst dann trotzdem weiter.
  const [arbeit] = await prisma.$queryRaw<{ n: number }[]>`
    select (select count(*) from crm.roboter_auftraege where status in ('freigegeben', 'in_arbeit'))::int
         + (select count(*) from crm.app_wuensche w where w.status = 'neu' and w.erledigt_am is null and w.erstellt_am > now() - interval '3 days'
              and not exists (select 1 from crm.roboter_auftraege a where w.id = any(a.wunsch_ids)))::int as n`;
  if (!arbeit?.n || stunde < 6 || stunde >= 22) return { ok: false, minuten, still: true };
  const alt = await prisma.setting.findUnique({ where: { key: WACHHUND } });
  if (alt && Date.now() - new Date(alt.value).getTime() < 3 * 3600_000) return { ok: false, minuten, schon: true };
  await prisma.setting.upsert({ where: { key: WACHHUND }, update: { value: new Date().toISOString() }, create: { key: WACHHUND, value: new Date().toISOString() } });
  const dauer = minuten >= 120 ? `${Math.round(minuten / 60)} Std.` : `${minuten} Min.`;
  await sendTelegram(`🚨 <b>Roboter steht</b> seit ${dauer} – ${arbeit.n} ${arbeit.n === 1 ? "Sache wartet" : "Sachen warten"}. Ist der PC an? Am PC: <code>systemctl --user restart roboter</code>`);
  return { ok: false, minuten, gemeldet: true };
}

/** Klingt der Kunde verärgert? Bewusst eng gefasst – lieber einmal zu wenig als ständig Fehlalarm. */
const SAUER = /(!!!|immer noch nicht|noch immer nicht|schon wieder nicht|nach wie vor nicht|wieder kaputt|umgehend|sauer|ärgerlich|verärgert|unzufrieden|katastroph|frechheit|inakzeptabel|nicht akzeptabel|kündig|reicht (jetzt|mir)|seit tagen|seit wochen|geht gar nicht|so geht das nicht)/i;

/**
 * Sofort Bescheid, wenn Christoph handeln muss oder etwas komisch ist (04.11.2026, Christoph: „wenn irgendwas öfter
 * danebengeht oder komisch ist … wenn ich handeln muss, wenn ein Kunde sauer ist“). Je Sache genau einmal
 * (Marke ACHTUNG:…), alles in EINER Nachricht je Durchlauf. Nachts (22–6) wartet es, bis 6 Uhr.
 */
async function achtung(stunde: number) {
  if (stunde < 6 || stunde >= 22) return { still: true };
  const [auftraege, namen] = await Promise.all([aktiveAuftraege(), kundenNamen()]);
  const name = (k: string | null) => esc(k ? namen.get(k) ?? k : "Roboter");
  const punkte: { key: string; zeile: string; knopf?: Knopf }[] = [];

  // 1) Ein Auftrag braucht Christoph (Rücksprache, ging nicht, Datenbank freigeben …).
  for (const a of auftraege.filter((x) => WARTET_AUF_DICH.includes(x.status))) {
    const was = a.status === "fehler" ? "⚠️ ging nicht" : a.status === "wartet" ? "❓ braucht deine Entscheidung" : a.status === "db_freigabe" ? "🗄 Datenbank freigeben" : "🟢 bitte ansehen";
    punkte.push({
      key: `ACHTUNG:auftrag:${a.id}:${a.status}`,
      zeile: `• ${name(a.app_key)} – ${was}${a.fehler ? `: ${esc(kuerzen(ohneMarkdown(a.fehler), 160))}` : ""}`,
      knopf: { text: `📄 ${kuerzen(namen.get(a.app_key) ?? a.app_key, 30)}`, data: `rob:zeig:${a.id}` },
    });
  }

  // 2) Geht öfter daneben: Kunde meldet dasselbe nochmal, Auftrag hängt, zurückgerollt, App-Check findet was.
  const notizen = await prisma.$queryRaw<{ id: string; art: string; app_key: string | null; text: string }[]>`
    select id::text as id, art, app_key, text from crm.roboter_notizen
    where art in ('rueckmelder', 'haengt', 'zurueckgerollt', 'appcheck') and erstellt_am > now() - interval '2 days'
    order by erstellt_am limit 20`;
  const titel: Record<string, string> = { rueckmelder: "🔁 kam wieder (Kunde sagt: geht noch nicht)", haengt: "⏳ hängt", zurueckgerollt: "↩️ nach dem Deploy kaputt, zurückgestellt", appcheck: "🔍 App-Check" };
  for (const n of notizen) punkte.push({ key: `ACHTUNG:notiz:${n.id}`, zeile: `• ${name(n.app_key)} – ${titel[n.art]}: ${esc(kuerzen(n.text, 200))}` });

  // 3) Mehrere Fehlversuche bei einem Kunden in 24 Std. (zurückgerollt/hängt öfter) → einmal am Tag zusammengefasst.
  const oft = await prisma.$queryRaw<{ app_key: string; n: number }[]>`
    select app_key, count(*)::int as n from crm.roboter_notizen
    where art in ('haengt', 'zurueckgerollt', 'notfall') and app_key is not null and erstellt_am > now() - interval '24 hours'
    group by app_key having count(*) >= 2`;
  const tag = new Date().toISOString().slice(0, 10);
  for (const o of oft) punkte.push({ key: `ACHTUNG:oft:${o.app_key}:${tag}`, zeile: `• ${name(o.app_key)} – ${o.n}× daneben in 24 Std., bitte mal draufschauen` });

  // 4) Kunde klingt verärgert.
  const wuensche = await prisma.$queryRaw<{ id: string; app_key: string; text: string; melder: string | null }[]>`
    select id::text as id, app_key, text, melder from crm.app_wuensche
    where erstellt_am > now() - interval '1 day' and coalesce(text, '') <> '' order by erstellt_am`;
  for (const w of wuensche.filter((x) => SAUER.test(x.text))) {
    punkte.push({ key: `ACHTUNG:sauer:${w.id}`, zeile: `• ${name(w.app_key)}${w.melder ? ` (${esc(kuerzen(w.melder, 40))})` : ""} – 😠 klingt verärgert: „${esc(kuerzen(ohneMarkdown(w.text), 180))}“` });
  }

  // 5) Wünsche bleiben liegen: über 3 Std. ohne Auftrag (der Roboter sollte sie längst haben) – einmal je Kunde und Tag.
  const liegen = await prisma.$queryRaw<{ app_key: string; n: number }[]>`
    select w.app_key, count(*)::int as n from crm.app_wuensche w
    where w.status = 'neu' and w.erledigt_am is null and w.erstellt_am between now() - interval '3 days' and now() - interval '3 hours'
      and not exists (select 1 from crm.roboter_auftraege a where w.id = any(a.wunsch_ids))
    group by w.app_key`;
  for (const l of liegen) punkte.push({ key: `ACHTUNG:liegt:${l.app_key}:${tag}`, zeile: `• ${name(l.app_key)} – ${l.n === 1 ? "1 Wunsch liegt" : `${l.n} Wünsche liegen`} seit über 3 Std., der Roboter nimmt ${l.n === 1 ? "ihn" : "sie"} nicht auf` });

  // Nur Neues melden – Marke vorab setzen, bei Sendefehler wieder entfernen.
  const neu: typeof punkte = [];
  for (const p of punkte) if (await einmal(p.key)) neu.push(p);
  if (!neu.length) return { neu: 0 };
  const buttons = neu.filter((p) => p.knopf).map((p) => [p.knopf!]);
  const r = await sendTelegram(["👀 <b>Achtung</b>", ...neu.map((p) => p.zeile)].join("\n"), buttons.length ? { buttons } : {});
  if (!r.ok) await prisma.setting.deleteMany({ where: { key: { in: neu.map((p) => p.key) } } });
  return { neu: neu.length, ok: r.ok };
}

async function tagesstand(frueh: boolean, woche: boolean, probe: boolean) {
  const zuletztRow = await prisma.setting.findUnique({ where: { key: ZULETZT } });
  const seit = zuletztRow ? new Date(zuletztRow.value) : new Date(Date.now() - 12 * 3600_000);
  const [auftraege, wuensche, namen] = await Promise.all([aktiveAuftraege(), offeneWuensche(), kundenNamen()]);
  const name = (k: string | null) => esc(k ? namen.get(k) ?? k : "Roboter");

  const z: string[] = [frueh ? "☀️ <b>Guten Morgen – Tagesstand</b>" : "🌙 <b>Tagesstand am Abend</b>"];
  const buttons: Knopf[][] = [];
  let zuTun = 0;

  // 1) Wartet auf Christoph: Rücksprachen, Fehler, Vorschläge – je ein Knopf, der die Karte mit ▶️ zeigt.
  const wartet = auftraege.filter((a) => WARTET_AUF_DICH.includes(a.status));
  if (wartet.length) {
    z.push("", "<b>Braucht dich</b>");
    for (const a of wartet) {
      const was = a.status === "fehler" ? "⚠️ ging nicht" : a.status === "wartet" ? "❓ Rücksprache" : a.status === "db_freigabe" ? "🗄 Datenbank freigeben" : "🟢 bitte ansehen";
      z.push(`• ${name(a.app_key)} – ${was}${a.fehler ? `: ${esc(kuerzen(ohneMarkdown(a.fehler), 160))}` : ""}`);
      buttons.push([{ text: `📄 ${kuerzen(namen.get(a.app_key) ?? a.app_key, 30)}`, data: `rob:zeig:${a.id}` }]);
    }
    zuTun += wartet.length;
  }

  // 2) Live, aber nicht ganz fertig (z. B. Kundenantwort ging nicht raus).
  const halb = await prisma.$queryRaw<{ app_key: string; fehler: string }[]>`
    select app_key, fehler from crm.roboter_auftraege
    where status = 'erledigt' and coalesce(fehler, '') <> '' and live_am > ${seit} order by live_am`;
  if (halb.length) {
    z.push("", "<b>Live, aber nicht ganz fertig</b>");
    for (const h of halb) z.push(`• ${name(h.app_key)}: ${esc(kuerzen(ohneMarkdown(h.fehler), 200))}`);
    zuTun += halb.length;
  }

  // 3) Wünsche, die seit über 2 Std. keiner angefasst hat (der Roboter sollte sie längst haben).
  const liegen = wuensche.filter((w) => !w.auftrag && Date.now() - new Date(w.erstellt_am).getTime() > 2 * 3600_000);
  if (liegen.length) {
    const je = new Map<string, number>();
    for (const w of liegen) je.set(w.app_key, (je.get(w.app_key) ?? 0) + 1);
    z.push("", "<b>Liegt noch</b>", ...[...je].map(([k, n]) => `• ${name(k)} – ${n === 1 ? "1 Wunsch" : `${n} Wünsche`}`));
    zuTun += liegen.length;
  }

  // 4) Was der Roboter seit dem letzten Tagesstand bemerkt hat (zurückgerollt, App-Check …).
  const notizen = await prisma.$queryRaw<{ id: string; art: string; app_key: string | null; text: string }[]>`
    select id::text as id, art, app_key, text from crm.roboter_notizen
    where im_tagesstand_am is null and art not in ('lehre', 'gegenprobe') and erstellt_am > now() - interval '7 days'
    order by erstellt_am limit 30`;
  if (notizen.length) {
    const titel: Record<string, string> = { notfall: "🚨 Notfall (schon gemeldet)", zurueckgerollt: "↩️ Zurückgestellt", appcheck: "🔍 App-Check", haengt: "⏳ Hängt" };
    z.push("", "<b>Bemerkt</b>");
    for (const n of notizen) z.push(`• ${titel[n.art] ?? n.art}: ${esc(kuerzen(n.text, 220))}`);
    zuTun += notizen.filter((n) => n.art !== "zurueckgerollt").length;
  }

  // 5) Roboter läuft?
  const [p] = await prisma.$queryRaw<{ zuletzt: Date | null }[]>`select zuletzt from crm.roboter_puls where id = 1`;
  if (!p?.zuletzt || Date.now() - new Date(p.zuletzt).getTime() > 20 * 60_000) {
    z.push("", "🚨 Der Roboter am PC antwortet gerade nicht (PC aus?).");
    zuTun++;
  }

  // 6) Erledigt – eine Zeile.
  const fertig = await prisma.$queryRaw<{ app_key: string; n: number }[]>`
    select app_key, count(*)::int as n from crm.roboter_auftraege
    where status = 'erledigt' and live_am > ${seit} group by app_key order by 2 desc`;
  const summe = fertig.reduce((s, f) => s + f.n, 0);
  z.push("", summe
    ? `✅ Erledigt ${frueh ? "seit gestern Abend" : "seit heute früh"}: ${summe} ${summe === 1 ? "Auftrag" : "Aufträge"} (${fertig.map((f) => name(f.app_key)).join(", ")})`
    : `✅ ${frueh ? "Über Nacht" : "Seit heute früh"} nichts Neues erledigt.`);
  if (!zuTun) z.splice(1, 0, "", "Nichts zu tun – alles läuft.");

  // 7) Montags: die Woche in Zahlen.
  if (woche) {
    const [w] = await prisma.$queryRaw<{ wuensche: number; erledigt: number; rueck: number; rueckmelder: number; gegen: number; zurueck: number }[]>`
      select
        (select count(*) from crm.app_wuensche where erstellt_am > now() - interval '7 days')::int as wuensche,
        (select count(*) from crm.roboter_auftraege where status = 'erledigt' and live_am > now() - interval '7 days')::int as erledigt,
        (select count(*) from crm.roboter_auftraege where wartet_seit > now() - interval '7 days')::int as rueck,
        -- echte Rückmelder: vom Auftrag selbst bestätigt ("rueckmelder" echt: true), nicht nur nach Stichworten (03.11.2026)
        (select count(*) from crm.roboter_notizen where art = 'rueckmelder' and erstellt_am > now() - interval '7 days')::int as rueckmelder,
        (select count(*) from crm.roboter_notizen where art = 'gegenprobe' and erstellt_am > now() - interval '7 days')::int as gegen,
        (select count(*) from crm.roboter_notizen where art = 'zurueckgerollt' and erstellt_am > now() - interval '7 days')::int as zurueck`;
    z.push("", `<b>Letzte Woche:</b> ${w.wuensche} Wünsche · ${w.erledigt} erledigt · ${w.rueck} Rücksprachen · ${w.rueckmelder} kamen wieder („geht noch immer nicht“) · Gegenprobe hat ${w.gegen}× nachgebessert · ${w.zurueck}× zurückgestellt`);
  }

  const r = await sendTelegram(z.join("\n"), { ...(buttons.length ? { buttons } : {}), leise: !zuTun });
  if (r.ok && !probe) {
    if (notizen.length) await prisma.$executeRaw`update crm.roboter_notizen set im_tagesstand_am = now() where id = any(${notizen.map((n) => n.id)}::uuid[])`;
    await prisma.setting.upsert({ where: { key: ZULETZT }, update: { value: new Date().toISOString() }, create: { key: ZULETZT, value: new Date().toISOString() } });
  }
  return { ok: r.ok, zuTun };
}
