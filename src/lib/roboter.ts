/**
 * Der Änderungswunsch-Roboter im Telegram-Bot.
 *
 * Kunden melden Wünsche in ihrer App → CRM (crm.app_wuensche). Der Roboter am PC
 * (_baukasten/werkzeuge/roboter) fasst sie je Kunde zu EINEM Vorschlag zusammen;
 * nach der Freigabe setzt er um, prüft den Build und schaltet selbst live.
 * Hier: Aufträge lesen und steuern (gleiche Datenbank, Schema crm) und die
 * Telegram-Karten mit Knöpfen bauen. Der Roboter liest den Status alle 60 s,
 * Fragen (crm.roboter_fragen) alle 15 s.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export interface Auftrag {
  id: string;
  app_key: string;
  wunsch_ids: string[];
  status: string;
  vorschlag: string | null;
  aufwand: string | null;
  risiko: string | null;
  datenbank: boolean;
  antwort_kunde: string | null;
  anmerkung: string | null;
  zweig: string | null;
  vorschau_url: string | null;
  fehler: string | null;
  protokoll: string | null;
  gemeldet: string | null;
  db_info: string | null; // Klartext: was sich in der Datenbank ändert/geändert hat
  yolo: boolean; // ohne Freigabe umgesetzt (YOLO-Modus des Kunden)
  freigegeben_am: Date | null; // gesetzt = Christoph (oder YOLO) hat den Vorschlag freigegeben
  sitzungen: string[]; // Claude-Sitzungen, in denen der Roboter daran gearbeitet hat
  ver: string; // Kurz-Prüfsumme von Vorschlag + Datenbank-Stand: ein „Ja“ gilt nur für den gezeigten Stand
  geprueft: string | null; // fertig umgesetzt und geprüft (Zweig-Stand) – „passt“ schaltet genau das live
  vor_kunde: string | null; // was vor der Antwort an den Kunden noch nötig ist (nur Christoph kann es)
  vor_kunde_ok_am: Date | null; // Christophs OK zu genau dieser Liste
  vk: string; // Kurz-Prüfsumme von vor_kunde: „✅ Erledigt“ gilt nur für die gezeigte Liste
  erstellt_am: Date;
  aktualisiert: Date;
}
export interface Wunsch {
  id: string;
  app_key: string;
  art: string;
  text: string;
  melder: string | null;
  erstellt_am: Date;
  auftrag?: string | null;
}
export type Knopf = { text: string; data?: string; url?: string };
export interface Karte {
  text: string;
  buttons: Knopf[][];
  leise?: boolean; // ohne Ton/Benachrichtigung (nur zur Info, z. B. „ist live“)
}

const CRM_LINK = "https://app.epowergmbh.at/wuensche#a-";
const AKTIV = ["analyse", "vorbereiten", "vorschlag", "aendern", "freigegeben", "in_arbeit", "vorschau", "live", "wartet", "fehler", "db_pruefen", "db_freigabe", "db_live"];
// In diese Aufträge dürfen neue Wünsche desselben Kunden noch dazu (noch nicht freigegeben).
const OFFEN_FUER_NEUE = ["analyse", "vorbereiten", "vorschlag", "aendern"];
// Wie im CRM: erledigt ist ein Wunsch, wenn umgesetzt/abgelehnt/gelöscht oder abgehakt.
const WUNSCH_ERLEDIGT = ["umgesetzt", "abgelehnt", "geloescht"];
// Hier läuft ein YOLO-Auftrag ohne Freigabe – „⏹ Stopp“ hält ihn vor Datenbank und Live an.
export const STOPPBAR = ["freigegeben", "in_arbeit", "db_pruefen", "db_live"];

const STATUS_TEXT: Record<string, string> = {
  analyse: "🔎 Roboter analysiert …",
  vorbereiten: "🛠 Roboter setzt um und prüft – die fertige Lösung kommt gleich",
  vorschlag: "🟡 Vorschlag zur Freigabe",
  aendern: "✏️ wird überarbeitet …",
  freigegeben: "🚀 freigegeben – startet gleich",
  in_arbeit: "🔧 wird umgesetzt und live geschaltet …",
  vorschau: "👀 Vorschau bereit",
  live: "🚀 wird live geschaltet …",
  erledigt: "✅ live",
  abgelehnt: "❌ abgelehnt",
  verworfen: "🗑 verworfen",
  wartet: "⏸ wartet auf dich",
  fehler: "⚠️ Fehler",
  db_pruefen: "🔎 prüft und spielt die Datenbank-Änderung ein …",
  db_freigabe: "🗄 Datenbank-Änderung braucht dein OK",
  db_live: "🗄 spielt die Datenbank ein und schaltet live …",
};

export const kurz = (id: string) => id.slice(0, 8);
export const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const kuerzen = (s: string | null, n: number) => {
  const t = (s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
/** Claude schreibt Markdown – Telegram zeigt ** und # sonst wörtlich. */
export const ohneMarkdown = (s: string) =>
  (s || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");

// „passt“ gilt nur für den gezeigten Stand: Vorschlag, Datenbank-Einordnung und geprüfter Zweig-Stand
const VER = Prisma.sql`left(md5(coalesce(vorschlag, '') || '|' || coalesce(db_hash, '') || '|' || coalesce(geprueft, '')), 8)`;
const VK = Prisma.sql`left(md5(coalesce(vor_kunde, '')), 8)`;
const SPALTEN = Prisma.sql`id::text as id, app_key, wunsch_ids, status, vorschlag, aufwand, risiko, datenbank,
  antwort_kunde, anmerkung, zweig, vorschau_url, fehler, protokoll, gemeldet, db_info, yolo, freigegeben_am, sitzungen,
  ${VER} as ver, geprueft, vor_kunde, vor_kunde_ok_am, ${VK} as vk, erstellt_am, aktualisiert`;

// ── Lesen ──────────────────────────────────────────────────────────────────
/** app_key → Kundenname (aus dem CRM; Apps ohne Kunde behalten ihren Schlüssel). */
export async function kundenNamen(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<{ app_key: string; name: string | null }[]>`
    select app_key, coalesce(nullif(trim(company_name), ''), nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')) as name
    from crm.customers where app_key is not null
    union all
    select distinct app_key, null from crm.app_wuensche where app_key is not null`;
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.app_key) || r.name) m.set(r.app_key, r.name || m.get(r.app_key) || r.app_key);
  return m;
}

export async function ladeAuftrag(ref: string): Promise<Auftrag | null> {
  const m = (ref || "").toLowerCase().match(/[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?/);
  if (!m) return null;
  const [a] = await prisma.$queryRaw<Auftrag[]>`
    select ${SPALTEN} from crm.roboter_auftraege where id::text like ${m[0] + "%"} order by erstellt_am desc limit 1`;
  return a ?? null;
}

export async function aktiveAuftraege(appKey?: string): Promise<Auftrag[]> {
  return prisma.$queryRaw<Auftrag[]>`
    select ${SPALTEN} from crm.roboter_auftraege
    where status = any(${AKTIV}) ${appKey ? Prisma.sql`and app_key = ${appKey}` : Prisma.empty}
    order by erstellt_am`;
}

export async function wuenscheZu(ids: string[]): Promise<Wunsch[]> {
  if (!ids?.length) return [];
  return prisma.$queryRaw<Wunsch[]>`
    select id, app_key, art, text, melder, erstellt_am from crm.app_wuensche where id = any(${ids}) order by erstellt_am`;
}

/** Offene Wünsche (wie im CRM) – mit dem Roboter-Auftrag, in dem sie schon stecken. */
export async function offeneWuensche(appKey?: string): Promise<Wunsch[]> {
  return prisma.$queryRaw<Wunsch[]>`
    select w.id, w.app_key, w.art, w.text, w.melder, w.erstellt_am,
      (select a.id::text from crm.roboter_auftraege a
        where w.id = any(a.wunsch_ids) and a.status not in ('verworfen', 'abgelehnt')
        order by a.erstellt_am desc limit 1) as auftrag
    from crm.app_wuensche w
    where w.status <> all(${WUNSCH_ERLEDIGT}) and w.erledigt_am is null
      ${appKey ? Prisma.sql`and w.app_key = ${appKey}` : Prisma.empty}
    order by w.erstellt_am`;
}

export async function roboterPuls(): Promise<{ laeuft: boolean; meldung: string | null }> {
  const [p] = await prisma.$queryRaw<{ zuletzt: Date | null; meldung: string | null }[]>`
    select zuletzt, meldung from crm.roboter_puls where id = 1`;
  const laeuft = !!p?.zuletzt && Date.now() - new Date(p.zuletzt).getTime() < 3 * 60_000;
  return { laeuft, meldung: p?.meldung ?? null };
}

/** Kunde aus einem Namen („schafferhofer“, „Ruff“) – nur eindeutige Treffer. */
export async function findeKunde(name: string): Promise<{ appKey?: string; name?: string; kandidaten?: string[] }> {
  const alle = [...(await kundenNamen())].map(([k, n]) => ({ k, n, such: `${k} ${n}`.toLowerCase() }));
  const q = (name || "").trim().toLowerCase();
  if (!q) return { kandidaten: alle.map((x) => x.n) };
  const stufen = [
    alle.filter((x) => x.k.toLowerCase() === q || x.n.toLowerCase() === q),
    alle.filter((x) => x.such.includes(q)),
    alle.filter((x) => q.split(/[\s,.-]+/).some((w) => w.length >= 4 && x.such.includes(w))),
  ];
  for (const t of stufen) {
    if (t.length === 1) return { appKey: t[0].k, name: t[0].n };
    if (t.length > 1) return { kandidaten: t.map((x) => x.n) };
  }
  return { kandidaten: alle.map((x) => x.n) };
}

/**
 * Den gemeinten Auftrag finden: per Nummer, sonst den wichtigsten des Kunden
 * (zuerst der Vorschlag zur Freigabe, dann was hängt).
 */
export async function auftragFuer(ref: { auftrag?: string; kunde?: string }): Promise<{ a?: Auftrag; kunde?: string; fehler?: string }> {
  if (ref.auftrag) {
    const a = await ladeAuftrag(ref.auftrag);
    if (a) return { a, kunde: (await kundenNamen()).get(a.app_key) ?? a.app_key };
    if (!ref.kunde) return { fehler: "Auftrag nicht gefunden." };
  }
  if (!ref.kunde) return { fehler: "Bitte Kunde oder Auftrag angeben." };
  const k = await findeKunde(ref.kunde);
  if (!k.appKey) return { fehler: `Kunde nicht eindeutig. Meintest du: ${(k.kandidaten || []).slice(0, 10).join(", ")}?` };
  const rang = ["vorschlag", "db_freigabe", "vorschau", "wartet", "fehler", "analyse", "aendern", "freigegeben", "in_arbeit", "db_pruefen", "db_live", "live"];
  const r = (s: string) => (rang.includes(s) ? rang.indexOf(s) : rang.length); // Unbekanntes ans Ende
  const liste = (await aktiveAuftraege(k.appKey)).sort((x, y) => r(x.status) - r(y.status));
  return liste[0] ? { a: liste[0], kunde: k.name } : { kunde: k.name, fehler: `Für ${k.name} läuft gerade kein Roboter-Auftrag.` };
}

// ── Steuern (nur erlaubte Übergänge – was der Roboter gerade macht, bleibt unberührt) ──
// Jeder Wechsel setzt gemeldet zurück: sonst bliebe ein zweiter Fehler/„wartet“ nach „Nochmal“ stumm.
async function wechsel(id: string, von: string[], setzen: Prisma.Sql, bedingung: Prisma.Sql = Prisma.empty): Promise<boolean> {
  const n = await prisma.$executeRaw`
    update crm.roboter_auftraege set ${setzen}, gemeldet = null, aktualisiert = now()
    where id = ${id}::uuid and status = any(${von}) ${bedingung}`;
  return n > 0;
}
/** Nur der gezeigte Stand (Vorschlag + Datenbank) – ein altes „Ja“ gibt keinen neuen Vorschlag frei. */
const nurStand = (ver?: string) => (ver ? Prisma.sql`and ${VER} = ${ver}` : Prisma.empty);
/** Nur Altaufträge aus Roboter 2.1: umgesetzt, Datenbank sollte von Hand eingespielt werden. */
export const handarbeit = (a: Auftrag) =>
  a.status === "wartet" && a.datenbank && !!a.zweig && /bewusst nicht selbst ein/.test(a.fehler ?? "");
/**
 * Live, aber vor der Antwort an den Kunden fehlt noch etwas, das nur Christoph kann (Roboter 2.8). Sein OK gibt es
 * nur über „✅ Erledigt“ (rob:vk, gebunden an genau diese Liste) – „Nochmal“ zählt hier nicht. Der Roboter prüft
 * danach den Live-Stand erneut und schickt dem Kunden erst dann die Antwort.
 */
export const vorDemKunden = (a: Auftrag) =>
  a.status === "wartet" && !!a.vor_kunde && !a.vor_kunde_ok_am && (a.fehler ?? "").startsWith("🧾 Vor dem Kunden");
// → „live“: Der Roboter geht direkt in den Live-Schritt (schon zusammengeführt) – prüft Live-Stand und Schlüssel
// erneut und schickt dem Kunden erst dann die Antwort. Geht auch bei Altaufträgen ohne Freigabe-Zeitpunkt.
export const vorKundeBestaetigen = (id: string, vk: string) =>
  wechsel(id, ["wartet"], Prisma.sql`status = 'live', vor_kunde_ok_am = now()`,
    Prisma.sql`and vor_kunde is not null and vor_kunde_ok_am is null and ${VK} = ${vk}
      and coalesce(fehler, '') like '🧾 Vor dem Kunden%'`);
/**
 * „ja passt, machen wir“ als Antwort auf die Karte einer fertigen Lösung: eindeutiges Ja, kurz, ohne Änderungswunsch.
 * Alles andere geht an den Roboter (der fragt nach oder überarbeitet).
 */
export function istJa(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  if (!t || t.length > 80 || t.includes("?")) return false;
  // Ohne \b: das kennt in JavaScript keine Umlaute („ändern“ würde übersehen). Klingt es nach Einschränkung oder
  // Änderungswunsch, geht es lieber an den Roboter.
  if (/(^|[^a-zäöüß])(nicht|nein|aber|änder|aender|anders|statt|noch|warte|stop|halt|später|spaeter|frage|lieber|sondern)/.test(t)) return false;
  return /^(ja|jo|jep|jup|yes|passt|ok|okay|oke|mach|los|go|gut|super|perfekt|freigeben|gib frei|schalt|live|top|👍|✅)/.test(t);
}

/** Bis zu dieser Länge passt die ganze Liste auf die Telegram-Karte – länger: nur im CRM bestätigen. */
export const VOR_KUNDE_TELEGRAM = 2400;

// fehler leeren: ein alter Hinweis (z. B. „YOLO wurde ausgeschaltet“) landete sonst als „ging schief“ im Umsetzen-Prompt.
export const freigeben = (id: string, ver?: string) =>
  wechsel(id, ["vorschlag"], Prisma.sql`status = 'freigegeben', freigegeben_am = now(), fehler = null,
    versuche = 0, naechster_versuch = null, wartet_seit = null`, nurStand(ver));
// Überarbeiteter Vorschlag muss neu freigegeben werden (sonst würde „Nochmal“ ihn nach einem Fehler umsetzen).
export const aendern = (id: string, anmerkung: string) =>
  wechsel(id, ["vorschlag", "vorschau"], Prisma.sql`status = 'aendern', anmerkung = ${anmerkung}, geprueft = null, versuche = 0,
    freigegeben_am = case when status = 'vorschlag' then null else freigegeben_am end`);
export const ablehnen = (id: string) => wechsel(id, ["vorschlag"], Prisma.sql`status = 'abgelehnt'`);
export const verwerfen = (id: string) =>
  wechsel(id, ["vorschlag", "vorschau", "wartet", "fehler", "db_freigabe"], Prisma.sql`status = 'verworfen'`);
/** YOLO-Auftrag anhalten: der Roboter prüft vor Datenbank und Live und bricht dann ab. */
export const stoppen = (id: string) => wechsel(id, STOPPBAR, Prisma.sql`status = 'verworfen'`, Prisma.sql`and yolo`);
export const liveSchalten = (id: string, ver?: string) => wechsel(id, ["vorschau"], Prisma.sql`status = 'live'`, nurStand(ver));
/** OK für eine Datenbank-Änderung, die Bestehendes verändert – gilt nur für den gezeigten Stand (db_hash). */
export const datenbankFreigeben = (id: string, ver?: string) =>
  wechsel(id, ["db_freigabe"], Prisma.sql`status = 'db_live'`, nurStand(ver));
/** Altaufträge, die wegen der Datenbank warten: Roboter prüft, spielt ein und schaltet live. */
export const datenbankEinspielen = (id: string, ver?: string) =>
  wechsel(id, ["wartet"], Prisma.sql`status = 'db_pruefen', fehler = null`, nurStand(ver));
export async function nochmal(a: Auftrag): Promise<boolean> {
  // Wartet der Kunde auf Christophs OK („vor dem Kunden“), ist „Nochmal“ kein OK – dafür gibt es „✅ Erledigt“.
  if (handarbeit(a) || vorDemKunden(a)) return false;
  // Umsetzen nur, wenn wirklich freigegeben wurde – ein bloß vorhandener Vorschlag reicht nicht
  // (ältere Aufträge: zurück zur Vorschau).
  // Vor der Freigabe gescheitert, aber schon analysiert → weiter umsetzen und prüfen (vorbereiten).
  const ziel = a.vorschau_url ? "vorschau" : a.freigegeben_am ? "freigegeben" : a.vorschlag ? "vorbereiten" : "analyse";
  return wechsel(a.id, ["wartet", "fehler"], Prisma.sql`status = ${ziel}, versuche = 0, naechster_versuch = null, wartet_seit = null`);
}

/**
 * Alle offenen Wünsche eines Kunden an den Roboter: in den offenen Vorschlag
 * (wird neu zusammengefasst) oder als neuer gemeinsamer Auftrag.
 */
export async function anRoboterGeben(appKey: string): Promise<{ auftrag?: string; neu: number; dazu: boolean; yolo: boolean }> {
  const freiW = (await offeneWuensche(appKey)).filter((w) => !w.auftrag);
  const frei = freiW.map((w) => w.id);
  if (!frei.length) return { neu: 0, dazu: false, yolo: false };
  const seit = (await yoloSeit()).get(appKey);
  const [offen] = await prisma.$queryRaw<{ id: string; wunsch_ids: string[] }[]>`
    select id::text as id, wunsch_ids from crm.roboter_auftraege
    where app_key = ${appKey} and status = any(${OFFEN_FUER_NEUE}) order by erstellt_am desc limit 1`;
  if (offen) {
    // Nur solange noch offen – hat der Roboter inzwischen freigegeben/umgesetzt, neuer Auftrag.
    const n = await prisma.$executeRaw`
      update crm.roboter_auftraege set wunsch_ids = wunsch_ids || ${frei}::text[], status = 'analyse', freigegeben_am = null, geprueft = null,
        gemeldet = null, aktualisiert = now()
      where id = ${offen.id}::uuid and status = any(${OFFEN_FUER_NEUE})`;
    if (n > 0) {
      const alle = [...freiW, ...(await wuenscheZu(offen.wunsch_ids))];
      return { auftrag: offen.id, neu: frei.length, dazu: true, yolo: yoloGreift(seit, alle) };
    }
  }
  const [n] = await prisma.$queryRaw<{ id: string }[]>`
    insert into crm.roboter_auftraege (app_key, wunsch_ids, status) values (${appKey}, ${frei}::text[], 'analyse') returning id::text as id`;
  return { auftrag: n.id, neu: frei.length, dazu: false, yolo: yoloGreift(seit, freiW) };
}

// ── YOLO-Modus je Kunde ────────────────────────────────────────────────────
/** Alle angebundenen Apps mit YOLO-Stand (auch die, die noch nie etwas gemeldet haben). */
export async function yoloListe(): Promise<{ appKey: string; name: string; an: boolean }[]> {
  const [namen, rows] = await Promise.all([
    kundenNamen(),
    prisma.$queryRaw<{ app_key: string; yolo: boolean }[]>`select app_key, yolo from crm.roboter_apps`,
  ]);
  const an = new Map(rows.map((r) => [r.app_key, r.yolo]));
  for (const k of an.keys()) if (!namen.has(k)) namen.set(k, k);
  return [...namen].map(([appKey, name]) => ({ appKey, name, an: !!an.get(appKey) })).sort((x, y) => x.name.localeCompare(y.name, "de"));
}

/** Seit wann YOLO je Kunde an ist (roboter_apps.aktualisiert = letztes Umschalten). */
export async function yoloSeit(): Promise<Map<string, Date>> {
  const rows = await prisma.$queryRaw<{ app_key: string; aktualisiert: Date }[]>`
    select app_key, aktualisiert from crm.roboter_apps where yolo`;
  return new Map(rows.map((r) => [r.app_key, new Date(r.aktualisiert)]));
}
/** YOLO an → jeder Auftrag des Kunden geht ohne Freigabe live, auch ältere Wünsche („das ist der Sinn des YOLO-Modus“). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const yoloGreift = (seit: Date | undefined, _wuensche?: { erstellt_am: Date }[]) => !!seit;

/**
 * YOLO an/aus. Beim Ausschalten warten noch nicht begonnene YOLO-Aufträge wieder auf die
 * Freigabe (zurückgegeben, damit man sie zeigen kann); laufende hält der Roboter selbst an.
 */
export async function yoloSetzen(appKey: string, an: boolean): Promise<Auftrag[]> {
  // aktualisiert nur beim echten Umschalten – davon hängt ab, welche Wünsche als „neu“ gelten.
  await prisma.$executeRaw`
    insert into crm.roboter_apps as r (app_key, yolo, aktualisiert) values (${appKey}, ${an}, now())
    on conflict (app_key) do update set yolo = excluded.yolo,
      aktualisiert = case when r.yolo is distinct from excluded.yolo then now() else r.aktualisiert end`;
  if (an) return [];
  // freigegeben_am weg: der Vorschlag ist jetzt nicht mehr freigegeben (wichtig für „Nochmal“).
  return prisma.$queryRaw<Auftrag[]>`
    update crm.roboter_auftraege set status = 'vorschlag', yolo = false, freigegeben_am = null, gemeldet = null, aktualisiert = now()
    where app_key = ${appKey} and yolo and status = 'freigegeben'
    returning ${SPALTEN}`;
}

export async function yoloKarte(): Promise<Karte> {
  const liste = await yoloListe();
  const aktiv = liste.filter((x) => x.an);
  const z = [
    "⚡ <b>YOLO-Modus</b>",
    "Ist er bei einem Kunden an, setzt der Roboter <b>alle</b> Wünsche dieses Kunden <b>ohne deine Freigabe</b> sofort um – auch Datenbank-Änderungen (vorher sichert er betroffene Tabellen; Riskantes steht in der Live-Meldung) – und schaltet live. Die Selbstprüfung (Build, Tests, Durchsicht) läuft trotzdem; besteht sie nicht, geht nichts live.",
    "",
    aktiv.length ? `An bei: <b>${aktiv.map((x) => esc(x.name)).join(", ")}</b>` : "Derzeit bei keinem Kunden an.",
    "<i>Tippe auf einen Kunden zum Umschalten.</i>",
  ];
  const buttons: Knopf[][] = liste.map((x) => [{ text: `${x.an ? "⚡ AN" : "○ aus"} · ${kuerzen(x.name, 30)}`, data: `rob:yolo:${x.appKey}:${x.an ? 0 : 1}` }]);
  return { text: z.join("\n"), buttons };
}

/** Rückfrage, bevor der Assistent YOLO einschaltet – eingeschaltet wird erst per Knopf. */
export function yoloBestaetigung(appKey: string, name: string): Karte {
  return {
    text: `⚡ YOLO für <b>${esc(name)}</b> einschalten?\nWünsche, die ab jetzt hereinkommen, setzt der Roboter dann <b>ohne deine Freigabe</b> um und schaltet sie live.`,
    buttons: [[{ text: "⚡ Ja, YOLO an", data: `rob:yolo:${appKey}:1` }, { text: "Abbrechen", data: "rob:x:0" }]],
  };
}

/** Frage an den Roboter (Claude am PC im Projektordner – kennt den Code, ändert nichts). */
export async function frageStellen(appKey: string, auftragId: string | null, frage: string): Promise<string> {
  const [f] = await prisma.$queryRaw<{ id: string }[]>`
    insert into crm.roboter_fragen (app_key, auftrag_id, frage) values (${appKey}, ${auftragId}::uuid, ${frage}) returning id::text as id`;
  return f.id;
}

// ── Gespräch mit dem Roboter (Telegram) ────────────────────────────────────
/**
 * „/chat schafferhofer“ bzw. „💬 Mit Roboter reden“: solange das Gespräch läuft, gehen Christophs
 * Nachrichten direkt an den Roboter dieses Kunden (Claude im Projekt-Verlauf) – bis /fertig oder
 * 30 Minuten Ruhe. Gemerkt in cockpit.Setting, nur eine Unterhaltung zur Zeit.
 */
const CHAT_KEY = "ROBOTER_CHAT";
const CHAT_RUHE_MS = 30 * 60_000;
export interface Gespraech { appKey: string; auftrag: string | null; bis: number }

export async function gespraechStarten(appKey: string, auftrag: string | null): Promise<void> {
  const v = JSON.stringify({ appKey, auftrag, bis: Date.now() + CHAT_RUHE_MS } satisfies Gespraech);
  await prisma.setting.upsert({ where: { key: CHAT_KEY }, create: { key: CHAT_KEY, value: v }, update: { value: v } });
}
export async function gespraechBeenden(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: CHAT_KEY } });
}
/** Laufendes Gespräch (und gleich um 30 Minuten verlängert) – oder null. */
export async function gespraech(verlaengern = false): Promise<Gespraech | null> {
  const row = await prisma.setting.findUnique({ where: { key: CHAT_KEY } });
  if (!row?.value) return null;
  try {
    const g = JSON.parse(row.value) as Gespraech;
    if (!g.appKey || g.bis < Date.now()) return null;
    if (verlaengern) await gespraechStarten(g.appKey, g.auftrag);
    return g;
  } catch {
    return null;
  }
}

// ── Telegram-Karten ────────────────────────────────────────────────────────
function knoepfe(a: Auftrag, bestaetigen: boolean): Knopf[][] {
  const id = a.id;
  const crm: Knopf = { text: "🔗 Im CRM", url: CRM_LINK + id };
  if (bestaetigen) {
    const ja = a.status === "vorschau" ? "🚀 Ja, live schalten" : ["db_freigabe", "wartet"].includes(a.status) ? "🗄 Ja, einspielen & live" : "✅ Ja, live schalten";
    return [[{ text: ja, data: `rob:ja:${id}:${a.ver}` }, { text: "↩︎ Zurück", data: `rob:zur:${id}` }]];
  }
  if (a.yolo && STOPPBAR.includes(a.status)) return [[{ text: "⏹ Stopp", data: `rob:stop:${id}` }, crm]];
  switch (a.status) {
    case "vorschlag":
      return [
        // Fertig umgesetzt und geprüft → ein Tipp genügt („passt“, an den gezeigten Stand gebunden).
        [a.geprueft ? { text: "✅ Passt – live schalten", data: `rob:ja:${id}:${a.ver}` } : { text: "✅ Freigeben & live", data: `rob:frei:${id}` },
          { text: "✏️ Ändern", data: `rob:aend:${id}` }],
        [{ text: "💬 Mit Roboter reden", data: `rob:chat:${id}` }, { text: "❌ Ablehnen", data: `rob:abl:${id}` }, crm],
      ];
    case "db_freigabe":
      return [
        [{ text: "🗄 Einspielen & live", data: `rob:frei:${id}` }],
        [{ text: "💬 Mit Roboter reden", data: `rob:chat:${id}` }, { text: "🗑 Verwerfen", data: `rob:verw:${id}` }, crm],
      ];
    case "vorschau":
      return [
        [...(a.datenbank ? [] : [{ text: "🚀 Live schalten", data: `rob:frei:${id}` }]), { text: "✏️ Ändern", data: `rob:aend:${id}` }],
        [{ text: "🗑 Verwerfen", data: `rob:verw:${id}` }, crm],
      ];
    case "wartet":
    case "fehler":
      return [
        [
          handarbeit(a)
            ? { text: "🗄 Datenbank einspielen & live", data: `rob:dbp:${id}` }
            : vorDemKunden(a)
              ? (a.vor_kunde ?? "").length <= VOR_KUNDE_TELEGRAM
                ? { text: "✅ Erledigt – Kunde bekommt Bescheid", data: `rob:vk:${id}:${a.vk}` }
                : { text: "✅ Im CRM bestätigen (Liste zu lang)", url: `${CRM_LINK}${id}` }
              : { text: "🔁 Nochmal versuchen", data: `rob:nochmal:${id}` },
          { text: "🗑 Verwerfen", data: `rob:verw:${id}` },
        ],
        [{ text: "💬 Mit Roboter reden", data: `rob:chat:${id}` }, crm],
      ];
    default:
      return [[crm]];
  }
}

/**
 * Karte eines Auftrags: Wünsche, Vorschlag, Antwort an den Kunden, Knöpfe.
 * Unten steht immer „Auftrag xxxxxxxx“ – darüber ordnet der Bot Antworten zu.
 */
type KartenOpts = { bestaetigen?: boolean; kopf?: string; verlauf?: string | null };
export function karte(a: Auftrag, wuensche: Wunsch[], kunde: string, opts: KartenOpts = {}): Karte {
  // Telegram erlaubt 4096 Zeichen (auch beim Bearbeiten) – große Aufträge werden knapper gebaut.
  let text = "";
  for (const f of [1, 0.5, 0.25]) {
    text = karteText(a, wuensche, kunde, opts, f);
    if (text.length <= 4000) break;
  }
  return { text, buttons: knoepfe(a, !!opts.bestaetigen) };
}

const MAX_WUENSCHE = 6;
function karteText(a: Auftrag, wuensche: Wunsch[], kunde: string, opts: KartenOpts, f: number): string {
  const n = (x: number) => Math.round(x * f);
  const kopf: string[] = [`${a.yolo ? "⚡" : "🤖"} <b>${esc(kuerzen(kunde, 60))}</b> · ${opts.kopf ?? STATUS_TEXT[a.status] ?? a.status}`];
  const info = [a.yolo && "YOLO-Modus", a.aufwand && `Aufwand ${a.aufwand}`, a.risiko && `Risiko ${a.risiko}`, a.datenbank && "mit Datenbank-Änderung"].filter(Boolean);
  if (info.length) kopf.push(`<i>${esc(kuerzen(info.join(" · "), 200))}</i>`);
  kopf.push("", `<b>${wuensche.length === 1 ? "Der Wunsch" : `${wuensche.length} Wünsche`}</b>`);
  wuensche.slice(0, MAX_WUENSCHE).forEach((w, i) =>
    kopf.push(`${i + 1}. ${esc(kuerzen(w.text.replace(/\s+/g, " "), n(200)))}${w.melder ? ` <i>– ${esc(kuerzen(w.melder, 40))}</i>` : ""}`));
  if (wuensche.length > MAX_WUENSCHE) kopf.push(`<i>… und ${wuensche.length - MAX_WUENSCHE} weitere (im CRM)</i>`);

  const fuss: string[] = [];
  const fertig = a.status === "vorschlag" && !!a.geprueft;   // fertig umgesetzt und geprüft, wartet auf „passt“
  if (fertig && a.protokoll) fuss.push("", "<b>So habe ich es gelöst</b>", esc(kuerzen(ohneMarkdown(a.protokoll), n(1200))));
  if (a.db_info && (fertig || ["db_freigabe", "db_live", "erledigt", "wartet", "fehler"].includes(a.status))) {
    fuss.push("", `<b>Datenbank${a.status === "db_freigabe" ? " – das würde sich ändern" : ""}</b>`, esc(kuerzen(a.db_info, n(900))));
  }
  if (fertig && a.vor_kunde) fuss.push("", "<b>🧾 Dafür brauche ich noch von dir</b>", esc(a.vor_kunde));
  if (a.protokoll && ["erledigt", "wartet", "fehler", "vorschau", "db_freigabe"].includes(a.status)) fuss.push("", "<b>Umgesetzt</b>", esc(kuerzen(ohneMarkdown(a.protokoll), n(700))));
  const vk = vorDemKunden(a);
  if (a.antwort_kunde && (["vorschlag", "vorschau"].includes(a.status) || vk)) fuss.push("", "<b>Antwort an den Kunden</b>", `<i>${esc(kuerzen(a.antwort_kunde, n(450)))}</i>`);
  if (vk) {
    // Die GANZE Liste – „✅ Erledigt“ bestätigt genau sie (Prüfsumme). Zu lang für Telegram → nur im CRM bestätigen.
    const liste = a.vor_kunde ?? "";
    fuss.push("", "<b>🧾 Bevor der Kunde Bescheid bekommt</b>",
      esc(liste.length <= VOR_KUNDE_TELEGRAM ? liste : kuerzen(liste, VOR_KUNDE_TELEGRAM)),
      "<i>Die Änderung ist schon live. Wenn das erledigt ist (oder es ohne geht): „✅ Erledigt“ – der Roboter prüft dann nochmal und schickt dem Kunden erst danach die Antwort.</i>");
  } else if (a.fehler && ["wartet", "fehler"].includes(a.status)) fuss.push("", `⚠️ ${esc(kuerzen(a.fehler, n(600)))}`);
  // z. B. „YOLO wurde ausgeschaltet – schon umgesetzt im Zweig …“
  if (a.fehler && a.status === "vorschlag") fuss.push("", `ℹ️ ${esc(kuerzen(a.fehler, n(400)))}`);
  if (opts.bestaetigen) {
    const alteMigrationen = /vorhandene Migrationsdatei/i.test(a.db_info ?? "")
      ? " Geänderte alte Migrationsdateien spielt er <b>nicht</b> ein – dafür geht nur der Code live." : "";
    fuss.push("", a.status === "vorschau"
      ? "<b>Wirklich live schalten?</b> Die Änderung geht an den Kunden raus, und er bekommt deine Antwort."
      : a.status === "db_freigabe"
        ? "<b>Wirklich einspielen & live schalten?</b> Tabellen, deren Daten verloren gehen könnten, sichert der Roboter vorher (Schema roboter_sicherung)." + alteMigrationen
        : a.status === "wartet"
          ? "<b>Wirklich Datenbank einspielen & live schalten?</b> Der Roboter prüft vorher selbst (Build, Tests, Durchsicht); verändert die Änderung Bestehendes, fragt er dich noch einmal."
          : "<b>Wirklich freigeben & live schalten?</b> Der Roboter setzt um, prüft selbst (Build, Tests, Durchsicht) und schaltet live – der Kunde bekommt die Antwort oben." +
            (a.datenbank ? " Neue Tabellen/Spalten spielt er selbst ein; verändert die Datenbank-Änderung Bestehendes, fragt er dich vorher noch einmal." : ""));
  } else if (["vorschlag", "wartet", "fehler", "db_freigabe"].includes(a.status)) {
    fuss.push("", "<i>Fragen oder Änderungen? Einfach auf diese Nachricht antworten.</i>");
  }
  // Der eine Claude-Verlauf je Kunde – dort kann Christoph selbst weiterschreiben. Name so, wie der Roboter ihn angelegt hat.
  if (opts.verlauf) fuss.push(`<i>Verlauf: VS Code → Projektordner des Kunden → Claude → „${esc(kuerzen(opts.verlauf, 60))}“</i>`);
  fuss.push(`<i>Auftrag ${kurz(a.id)}</i>`);

  // Der Vorschlag bekommt, was übrig bleibt.
  let mitte: string[] = [];
  if (a.vorschlag && a.status !== "erledigt" && !(fertig && a.protokoll)) {
    const rest = n(3800) - kopf.join("\n").length - fuss.join("\n").length - 60;
    mitte = ["", "<b>So würde ich es machen</b>", esc(kuerzen(ohneMarkdown(a.vorschlag), Math.max(n(300), rest)))];
  }
  return [...kopf, ...mitte, ...fuss].join("\n");
}

export async function karteFuer(a: Auftrag, opts: KartenOpts = {}): Promise<Karte> {
  const [w, namen, [app]] = await Promise.all([
    wuenscheZu(a.wunsch_ids),
    kundenNamen(),
    prisma.$queryRaw<{ sitzung_name: string | null }[]>`select sitzung_name from crm.roboter_apps where app_key = ${a.app_key}`,
  ]);
  return karte(a, w, namen.get(a.app_key) ?? a.app_key, { verlauf: app?.sitzung_name, ...opts });
}

/** Was der Roboter zu einer Stufe meldet (Vorschlag, live, wartet, Fehler). */
export async function meldungFuerAuftrag(a: Auftrag): Promise<Karte | null> {
  // Christoph (24.09.2026): „die Nachricht nur, wenn er die Lösung schon parat hat – ich sage nur noch ja passt“.
  if (a.status === "vorschlag") return karteFuer(a, { kopf: a.geprueft ? "🟢 Lösung fertig und geprüft – passt?" : "🟡 neuer Vorschlag – bitte ansehen" });
  if (["wartet", "fehler", "vorschau", "db_freigabe"].includes(a.status)) return karteFuer(a);
  if (a.status === "erledigt") {
    const kunde = (await kundenNamen()).get(a.app_key) ?? a.app_key;
    // Riskantes aus der Datenbank-Prüfung (⚠️-Zeilen) nie wegkürzen – gerade bei YOLO ging es ohne Rückfrage durch.
    const zeilen = (a.db_info || "").split("\n");
    const risiken = zeilen.filter((z) => z.trim().startsWith("⚠️")).slice(0, 8);
    const sonst = zeilen.filter((z) => !z.trim().startsWith("⚠️")).join("\n").trim();
    return {
      text:
        `✅ <b>${esc(kunde)}</b> ist live${a.yolo ? " (YOLO)" : ""}.` +
        (a.protokoll ? `\n\n${esc(kuerzen(ohneMarkdown(a.protokoll), 1500))}` : "") +
        (risiken.length ? `\n\n<b>⚠️ Datenbank – bitte ansehen</b>\n${risiken.map((z) => esc(kuerzen(z.trim(), 300))).join("\n")}` : "") +
        (sonst ? `\n\n<b>Datenbank</b>\n${esc(kuerzen(sonst, 800))}` : "") +
        (a.fehler ? `\n\n⚠️ ${esc(a.fehler)}` : `\n\n<i>Der Kunde sieht „umgesetzt“ mit deiner Antwort.</i>`) +
        `\n<i>Auftrag ${kurz(a.id)}</i>`,
      buttons: [[{ text: "🔗 Im CRM", url: CRM_LINK + a.id }]],
      leise: true, // nur zur Info – kommt ohne Ton
    };
  }
  return null;
}

/** Übersicht: was wartet auf Christoph, woran arbeitet der Roboter, was ist noch nicht beim Roboter. */
export async function uebersicht(): Promise<Karte> {
  const [auftraege, wuensche, namen, puls, seit] = await Promise.all([aktiveAuftraege(), offeneWuensche(), kundenNamen(), roboterPuls(), yoloSeit()]);
  const name = (k: string) => namen.get(k) ?? k;
  const z: string[] = ["🤖 <b>Änderungswünsche</b>"];
  z.push(puls.laeuft ? `<i>Roboter läuft${puls.meldung && puls.meldung !== "bereit" ? ` – ${esc(puls.meldung)}` : ""}</i>` : "<i>⚠️ Roboter am PC antwortet gerade nicht (PC aus?)</i>");
  const buttons: Knopf[][] = [];
  const gruppe = (titel: string, stati: string[], knopf: boolean) => {
    const liste = auftraege.filter((a) => stati.includes(a.status));
    if (!liste.length) return;
    z.push("", `<b>${titel}</b>`);
    for (const a of liste) {
      z.push(`• ${esc(name(a.app_key))} – ${a.wunsch_ids.length === 1 ? "1 Wunsch" : `${a.wunsch_ids.length} Wünsche`} · ${STATUS_TEXT[a.status] ?? a.status}`);
      // YOLO-Aufträge auch hier erreichbar – die Karte hat den Stopp-Knopf.
      const stoppbar = a.yolo && STOPPBAR.includes(a.status);
      if (knopf || stoppbar) buttons.push([{ text: `📄 ${kuerzen(name(a.app_key), 28)}${stoppbar ? " (YOLO)" : ""}`, data: `rob:zeig:${a.id}` }]);
    }
  };
  gruppe("Wartet auf dich", ["vorschlag", "vorschau", "wartet", "fehler", "db_freigabe"], true);
  gruppe("Roboter arbeitet", ["analyse", "aendern", "freigegeben", "in_arbeit", "live", "db_pruefen", "db_live"], false);

  const ohne = new Map<string, number>();
  for (const w of wuensche) if (!w.auftrag) ohne.set(w.app_key, (ohne.get(w.app_key) ?? 0) + 1);
  if (ohne.size) {
    z.push("", "<b>Noch nicht beim Roboter</b>");
    for (const [k, n] of ohne) {
      z.push(`• ${esc(name(k))} – ${n === 1 ? "1 Wunsch" : `${n} Wünsche`}`);
      // Wie anRoboterGeben: die Wünsche kommen evtl. zu einem offenen Vorschlag dazu.
      const offen = auftraege.filter((a) => a.app_key === k && OFFEN_FUER_NEUE.includes(a.status)).pop();
      const direkt = yoloGreift(seit.get(k), wuensche.filter((w) => w.app_key === k && (!w.auftrag || w.auftrag === offen?.id)));
      buttons.push([{ text: `${direkt ? "⚡ Umsetzen (YOLO)" : "🤖 Vorschlag"}: ${kuerzen(name(k), 22)} (${n})`, data: `rob:start:${k}` }]);
    }
  }
  if (!auftraege.length && !ohne.size) z.push("", "🎉 Keine offenen Änderungswünsche.");
  const yolo = (await yoloListe()).filter((x) => x.an);
  if (yolo.length) z.push("", `⚡ YOLO an bei: ${yolo.map((x) => esc(x.name)).join(", ")} <i>(/yolo)</i>`);
  return { text: z.join("\n"), buttons };
}
