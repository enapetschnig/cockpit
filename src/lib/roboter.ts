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
}

const CRM_LINK = "https://app.epowergmbh.at/wuensche#a-";
const AKTIV = ["analyse", "vorschlag", "aendern", "freigegeben", "in_arbeit", "vorschau", "live", "wartet", "fehler"];
// In diese Aufträge dürfen neue Wünsche desselben Kunden noch dazu (noch nicht freigegeben).
const OFFEN_FUER_NEUE = ["analyse", "vorschlag", "aendern"];
// Wie im CRM: erledigt ist ein Wunsch, wenn umgesetzt/abgelehnt/gelöscht oder abgehakt.
const WUNSCH_ERLEDIGT = ["umgesetzt", "abgelehnt", "geloescht"];

const STATUS_TEXT: Record<string, string> = {
  analyse: "🔎 Roboter analysiert …",
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
};

export const kurz = (id: string) => id.slice(0, 8);
export const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const kuerzen = (s: string | null, n: number) => {
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

const SPALTEN = Prisma.sql`id::text as id, app_key, wunsch_ids, status, vorschlag, aufwand, risiko, datenbank,
  antwort_kunde, anmerkung, zweig, vorschau_url, fehler, protokoll, gemeldet, erstellt_am, aktualisiert`;

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
  const rang = ["vorschlag", "vorschau", "wartet", "fehler", "analyse", "aendern", "freigegeben", "in_arbeit", "live"];
  const liste = (await aktiveAuftraege(k.appKey)).sort((x, y) => rang.indexOf(x.status) - rang.indexOf(y.status));
  return liste[0] ? { a: liste[0], kunde: k.name } : { kunde: k.name, fehler: `Für ${k.name} läuft gerade kein Roboter-Auftrag.` };
}

// ── Steuern (nur erlaubte Übergänge – was der Roboter gerade macht, bleibt unberührt) ──
async function wechsel(id: string, von: string[], setzen: Prisma.Sql): Promise<boolean> {
  const n = await prisma.$executeRaw`
    update crm.roboter_auftraege set ${setzen}, aktualisiert = now() where id = ${id}::uuid and status = any(${von})`;
  return n > 0;
}
/** Umgesetzt mit Datenbank-Änderung: live schaltet Christoph mit Claude in VS Code. */
export const handarbeit = (a: Auftrag) => a.status === "wartet" && a.datenbank && !!a.zweig;

export const freigeben = (id: string) => wechsel(id, ["vorschlag"], Prisma.sql`status = 'freigegeben', freigegeben_am = now()`);
export const aendern = (id: string, anmerkung: string) =>
  wechsel(id, ["vorschlag", "vorschau"], Prisma.sql`status = 'aendern', anmerkung = ${anmerkung}, gemeldet = null`);
export const ablehnen = (id: string) => wechsel(id, ["vorschlag"], Prisma.sql`status = 'abgelehnt'`);
export const verwerfen = (id: string) => wechsel(id, ["vorschlag", "vorschau", "wartet", "fehler"], Prisma.sql`status = 'verworfen'`);
export const liveSchalten = (id: string) => wechsel(id, ["vorschau"], Prisma.sql`status = 'live'`);
export const inVsCodeErledigt = (id: string) => wechsel(id, ["wartet"], Prisma.sql`status = 'erledigt', fehler = null`);
export async function nochmal(a: Auftrag): Promise<boolean> {
  if (handarbeit(a)) return false;
  // Dort weitermachen, wo es hakte (ältere Aufträge: zurück zur Vorschau)
  const ziel = !a.vorschlag ? "analyse" : a.vorschau_url ? "vorschau" : "freigegeben";
  return wechsel(a.id, ["wartet", "fehler"], Prisma.sql`status = ${ziel}`);
}

/**
 * Alle offenen Wünsche eines Kunden an den Roboter: in den offenen Vorschlag
 * (wird neu zusammengefasst) oder als neuer gemeinsamer Auftrag.
 */
export async function anRoboterGeben(appKey: string): Promise<{ auftrag?: string; neu: number; dazu: boolean }> {
  const frei = (await offeneWuensche(appKey)).filter((w) => !w.auftrag).map((w) => w.id);
  if (!frei.length) return { neu: 0, dazu: false };
  const [offen] = await prisma.$queryRaw<{ id: string }[]>`
    select id::text as id from crm.roboter_auftraege
    where app_key = ${appKey} and status = any(${OFFEN_FUER_NEUE}) order by erstellt_am desc limit 1`;
  if (offen) {
    await prisma.$executeRaw`
      update crm.roboter_auftraege set wunsch_ids = wunsch_ids || ${frei}::text[], status = 'analyse', gemeldet = null, aktualisiert = now()
      where id = ${offen.id}::uuid`;
    return { auftrag: offen.id, neu: frei.length, dazu: true };
  }
  const [n] = await prisma.$queryRaw<{ id: string }[]>`
    insert into crm.roboter_auftraege (app_key, wunsch_ids, status) values (${appKey}, ${frei}::text[], 'analyse') returning id::text as id`;
  return { auftrag: n.id, neu: frei.length, dazu: false };
}

/** Frage an den Roboter (Claude am PC im Projektordner – kennt den Code, ändert nichts). */
export async function frageStellen(appKey: string, auftragId: string | null, frage: string): Promise<string> {
  const [f] = await prisma.$queryRaw<{ id: string }[]>`
    insert into crm.roboter_fragen (app_key, auftrag_id, frage) values (${appKey}, ${auftragId}::uuid, ${frage}) returning id::text as id`;
  return f.id;
}

// ── Telegram-Karten ────────────────────────────────────────────────────────
function knoepfe(a: Auftrag, bestaetigen: boolean): Knopf[][] {
  const id = a.id;
  const crm: Knopf = { text: "🔗 Im CRM", url: CRM_LINK + id };
  if (bestaetigen) {
    return [[
      { text: a.status === "vorschau" ? "🚀 Ja, live schalten" : a.datenbank ? "✅ Ja, freigeben" : "✅ Ja, live schalten", data: `rob:ja:${id}` },
      { text: "↩︎ Zurück", data: `rob:zur:${id}` },
    ]];
  }
  switch (a.status) {
    case "vorschlag":
      return [
        [{ text: a.datenbank ? "✅ Freigeben" : "✅ Freigeben & live", data: `rob:frei:${id}` }, { text: "✏️ Ändern", data: `rob:aend:${id}` }],
        [{ text: "💬 Frage", data: `rob:frage:${id}` }, { text: "❌ Ablehnen", data: `rob:abl:${id}` }, crm],
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
          handarbeit(a) ? { text: "✔️ In VS Code erledigt", data: `rob:vsc:${id}` } : { text: "🔁 Nochmal versuchen", data: `rob:nochmal:${id}` },
          { text: "🗑 Verwerfen", data: `rob:verw:${id}` },
        ],
        [{ text: "💬 Frage", data: `rob:frage:${id}` }, crm],
      ];
    default:
      return [[crm]];
  }
}

/**
 * Karte eines Auftrags: Wünsche, Vorschlag, Antwort an den Kunden, Knöpfe.
 * Unten steht immer „Auftrag xxxxxxxx“ – darüber ordnet der Bot Antworten zu.
 */
export function karte(a: Auftrag, wuensche: Wunsch[], kunde: string, opts: { bestaetigen?: boolean; kopf?: string } = {}): Karte {
  const kopf: string[] = [`🤖 <b>${esc(kunde)}</b> · ${opts.kopf ?? STATUS_TEXT[a.status] ?? a.status}`];
  const info = [a.aufwand && `Aufwand ${a.aufwand}`, a.risiko && `Risiko ${a.risiko}`, a.datenbank && "⚠️ braucht Datenbank-Änderung"].filter(Boolean);
  if (info.length) kopf.push(`<i>${esc(info.join(" · "))}</i>`);
  kopf.push("", `<b>${wuensche.length === 1 ? "Der Wunsch" : `${wuensche.length} Wünsche`}</b>`);
  wuensche.forEach((w, i) => kopf.push(`${i + 1}. ${esc(kuerzen(w.text.replace(/\s+/g, " "), 200))}${w.melder ? ` <i>– ${esc(w.melder)}</i>` : ""}`));

  const fuss: string[] = [];
  if (a.protokoll && ["erledigt", "wartet", "fehler", "vorschau"].includes(a.status)) fuss.push("", "<b>Umgesetzt</b>", esc(kuerzen(ohneMarkdown(a.protokoll), 900)));
  if (a.antwort_kunde && ["vorschlag", "vorschau"].includes(a.status)) fuss.push("", "<b>Antwort an den Kunden</b>", `<i>${esc(kuerzen(a.antwort_kunde, 450))}</i>`);
  if (a.fehler && ["wartet", "fehler"].includes(a.status)) fuss.push("", `⚠️ ${esc(kuerzen(a.fehler, 600))}`);
  if (opts.bestaetigen) {
    fuss.push("", a.status === "vorschau"
      ? "<b>Wirklich live schalten?</b> Die Änderung geht an den Kunden raus, und er bekommt deine Antwort."
      : a.datenbank
        ? "<b>Freigeben?</b> Der Roboter setzt es um. Wegen der Datenbank-Änderung schaltest du es danach mit Claude in VS Code live."
        : "<b>Wirklich freigeben & live schalten?</b> Der Roboter setzt um, prüft den Build und schaltet selbst live – der Kunde bekommt die Antwort oben.");
  } else if (["vorschlag", "wartet", "fehler"].includes(a.status)) {
    fuss.push("", "<i>Fragen oder Änderungen? Einfach auf diese Nachricht antworten.</i>");
  }
  fuss.push(`<i>Auftrag ${kurz(a.id)}</i>`);

  // Telegram erlaubt 4096 Zeichen – der Vorschlag bekommt, was übrig bleibt.
  let mitte: string[] = [];
  if (a.vorschlag && a.status !== "erledigt") {
    const rest = 3800 - kopf.join("\n").length - fuss.join("\n").length - 60;
    mitte = ["", "<b>So würde ich es machen</b>", esc(kuerzen(ohneMarkdown(a.vorschlag), Math.max(300, rest)))];
  }
  return { text: [...kopf, ...mitte, ...fuss].join("\n"), buttons: knoepfe(a, !!opts.bestaetigen) };
}

export async function karteFuer(a: Auftrag, opts: { bestaetigen?: boolean; kopf?: string } = {}): Promise<Karte> {
  const [w, namen] = await Promise.all([wuenscheZu(a.wunsch_ids), kundenNamen()]);
  return karte(a, w, namen.get(a.app_key) ?? a.app_key, opts);
}

/** Was der Roboter zu einer Stufe meldet (Vorschlag, live, wartet, Fehler). */
export async function meldungFuerAuftrag(a: Auftrag): Promise<Karte | null> {
  if (a.status === "vorschlag") return karteFuer(a, { kopf: "🟡 neuer Vorschlag – bitte ansehen" });
  if (["wartet", "fehler", "vorschau"].includes(a.status)) return karteFuer(a);
  if (a.status === "erledigt") {
    const kunde = (await kundenNamen()).get(a.app_key) ?? a.app_key;
    return {
      text:
        `✅ <b>${esc(kunde)}</b> ist live.` +
        (a.protokoll ? `\n\n${esc(kuerzen(ohneMarkdown(a.protokoll), 1500))}` : "") +
        (a.fehler ? `\n\n⚠️ ${esc(a.fehler)}` : `\n\n<i>Der Kunde sieht „umgesetzt“ mit deiner Antwort.</i>`) +
        `\n<i>Auftrag ${kurz(a.id)}</i>`,
      buttons: [[{ text: "🔗 Im CRM", url: CRM_LINK + a.id }]],
    };
  }
  return null;
}

/** Übersicht: was wartet auf Christoph, woran arbeitet der Roboter, was ist noch nicht beim Roboter. */
export async function uebersicht(): Promise<Karte> {
  const [auftraege, wuensche, namen, puls] = await Promise.all([aktiveAuftraege(), offeneWuensche(), kundenNamen(), roboterPuls()]);
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
      if (knopf) buttons.push([{ text: `📄 ${kuerzen(name(a.app_key), 28)}`, data: `rob:zeig:${a.id}` }]);
    }
  };
  gruppe("Wartet auf dich", ["vorschlag", "vorschau", "wartet", "fehler"], true);
  gruppe("Roboter arbeitet", ["analyse", "aendern", "freigegeben", "in_arbeit", "live"], false);

  const ohne = new Map<string, number>();
  for (const w of wuensche) if (!w.auftrag) ohne.set(w.app_key, (ohne.get(w.app_key) ?? 0) + 1);
  if (ohne.size) {
    z.push("", "<b>Noch nicht beim Roboter</b>");
    for (const [k, n] of ohne) {
      z.push(`• ${esc(name(k))} – ${n === 1 ? "1 Wunsch" : `${n} Wünsche`}`);
      buttons.push([{ text: `🤖 Vorschlag: ${kuerzen(name(k), 22)} (${n})`, data: `rob:start:${k}` }]);
    }
  }
  if (!auftraege.length && !ohne.size) z.push("", "🎉 Keine offenen Änderungswünsche.");
  return { text: z.join("\n"), buttons };
}
