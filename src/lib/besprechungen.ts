import { prisma } from "@/lib/db";
import { INHABER_USER_IDS } from "@/lib/inhaber";
import { esc } from "@/lib/roboter";
import type { TgButton } from "@/lib/telegram";

/**
 * Besprechungen aus Plaud (crm.besprechungen). Der PC (_baukasten/werkzeuge/plaud/plaud.mjs) holt die Aufnahmen,
 * Claude ordnet sie einem Kunden oder Lead zu; das Cockpit schickt EINE Zeile nach Telegram.
 * Ist die Zuordnung unklar, antwortet Christoph einfach mit dem Namen (oder tippt einen Vorschlag an).
 */

const CRM_URL = "https://app.epowergmbh.at";
type Karte = { text: string; buttons: TgButton[][] };
type Besprechung = {
  id: string; titel: string | null; status: string; begruendung: string | null;
  handlungsschritte: { text: string; erledigt?: boolean }[] | null; wer: string | null;
};

const kurz = (id: string) => id.slice(0, 8);
const fuss = (id: string) => `<i>Besprechung ${kurz(id)}</i>`;

async function lade(ref: string): Promise<Besprechung | null> {
  const [b] = await prisma.$queryRaw<Besprechung[]>`
    select b.id::text as id, b.titel, b.status, b.begruendung, b.handlungsschritte,
      coalesce(nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
               nullif(l.company_name, ''), l.full_name) as wer
    from crm.besprechungen b
    left join crm.customers c on c.id = b.customer_id
    left join crm.leads l on l.id = b.lead_id
    where b.id::text like ${ref + "%"}
    order by b.erstellt_am desc limit 1`;
  return b ?? null;
}

function schritte(b: Besprechung): string {
  const s = (b.handlungsschritte ?? []).filter((x) => x.text);
  if (!s.length) return "";
  return "\n" + s.slice(0, 6).map((x) => `• ${esc(x.text)}`).join("\n") + (s.length > 6 ? `\n• … und ${s.length - 6} weitere` : "");
}

function abgelegt(b: Besprechung): Karte {
  const n = (b.handlungsschritte ?? []).length;
  return {
    text: `🎙 Besprechung mit <b>${esc(b.wer ?? "?")}</b> abgelegt${n ? ` – ${n} Handlungsschritt${n === 1 ? "" : "e"}:` : "."}${schritte(b)}\n${fuss(b.id)}`,
    buttons: [[{ text: "Im CRM ansehen", url: `${CRM_URL}/besprechungen` }]],
  };
}

/** Telegram-Zeile zu einer neuen Besprechung – genau einmal (gemeldet). */
export async function besprechungMeldung(id: string): Promise<Karte | null> {
  const [frei] = await prisma.$queryRaw<{ id: string }[]>`
    update crm.besprechungen set gemeldet = now()
    where id = ${id}::uuid and gemeldet is null and status in ('zugeordnet', 'unklar') and erstellt_am > now() - interval '1 day'
    returning id::text as id`;
  if (!frei) return null;
  const b = await lade(frei.id);
  if (!b) return null;
  if (b.status === "zugeordnet") return abgelegt(b);
  const vermutung = b.wer ? ` Vermutlich <b>${esc(b.wer)}</b>?` : "";
  return {
    text: `❓ Besprechung „${esc(b.titel || "ohne Titel")}“ – zu wem gehört die?${vermutung}\nAntworte einfach mit dem Namen (oder „privat“).${schritte(b)}\n${fuss(b.id)}`,
    buttons: b.wer ? [[{ text: `✅ ${b.wer}`.slice(0, 60), data: `bsp:ok:${kurz(b.id)}` }, { text: "Privat", data: `bsp:weg:${kurz(b.id)}` }]]
      : [[{ text: "Privat / keine Besprechung", data: `bsp:weg:${kurz(b.id)}` }]],
  };
}

export const besprechungsRef = (bezug: string) => [...bezug.matchAll(/Besprechung ([0-9a-f]{8})\b/g)].pop()?.[1] ?? null;

/** Antwort auf „❓ zu wem gehört die?“: Name → genau ein Kunde/Lead → zuordnen. Mehrere → zur Auswahl. */
export async function zuordnenPerText(ref: string, text: string): Promise<Karte> {
  const b = await lade(ref);
  if (!b) return { text: "Die Besprechung finde ich nicht mehr.", buttons: [] };
  const t = text.trim();
  if (/^(privat|nichts|keine?|egal|weg|ignorier\w*)\b/i.test(t)) {
    await prisma.$executeRaw`update crm.besprechungen set status = 'ignoriert', customer_id = null, lead_id = null, aktualisiert = now() where id = ${b.id}::uuid`;
    return { text: "👍 Als privat abgelegt – taucht beim Kunden nicht auf.", buttons: [] };
  }
  const muster = `%${t.replace(/[%_\\]/g, "")}%`;
  // Nur CRM-Daten des Inhabers – andere Konten im geteilten Projekt zählen nicht.
  const ids = [...INHABER_USER_IDS];
  const treffer = await prisma.$queryRaw<{ art: "k" | "l"; id: string; name: string }[]>`
    (select 'k' as art, id::text as id,
       concat_ws(' · ', nullif(company_name, ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), city) as name
     from crm.customers
     where user_id::text = any(${ids}::text[])
       and (company_name ilike ${muster} or concat_ws(' ', first_name, last_name) ilike ${muster} or concat_ws(' ', last_name, first_name) ilike ${muster})
     limit 6)
    union all
    (select 'l', id::text, concat_ws(' · ', nullif(company_name, ''), full_name, 'Lead')
     from crm.leads where user_id::text = any(${ids}::text[]) and (company_name ilike ${muster} or full_name ilike ${muster}) limit 6)`;
  if (treffer.length === 1) return zuordnen(b.id, treffer[0].art, treffer[0].id);
  if (!treffer.length) return { text: `Zu „${esc(t)}“ finde ich im CRM niemanden. Schreib den Firmen- oder Nachnamen, wie er im CRM steht.\n${fuss(b.id)}`, buttons: [] };
  return {
    text: `Mehrere passen – welcher?\n${fuss(b.id)}`,
    buttons: treffer.slice(0, 8).map((x) => [{ text: x.name.slice(0, 60), data: `bsp:${x.art}:${kurz(b.id)}:${x.id}` }]),
  };
}

async function zuordnen(id: string, art: "k" | "l", zielId: string): Promise<Karte> {
  await prisma.$executeRaw`update crm.besprechungen
    set status = 'zugeordnet', customer_id = ${art === "k" ? zielId : null}::uuid, lead_id = ${art === "l" ? zielId : null}::uuid, aktualisiert = now()
    where id = ${id}::uuid`;
  const b = await lade(id);
  return b ? abgelegt(b) : { text: "Zugeordnet.", buttons: [] };
}

/** Knöpfe bsp:ok:<ref> · bsp:weg:<ref> · bsp:k|l:<ref>:<uuid> */
export async function besprechungKnopf(data: string): Promise<Karte> {
  const [, aktion, ref, ziel] = data.split(":");
  const b = ref ? await lade(ref) : null;
  if (!b) return { text: "Die Besprechung finde ich nicht mehr.", buttons: [] };
  if (aktion === "weg") return zuordnenPerText(b.id.slice(0, 8), "privat");
  if (aktion === "ok") {
    await prisma.$executeRaw`update crm.besprechungen set status = 'zugeordnet', aktualisiert = now()
      where id = ${b.id}::uuid and (customer_id is not null or lead_id is not null)`;
    const neu = await lade(b.id);
    return neu?.status === "zugeordnet" ? abgelegt(neu) : { text: "Da ist noch niemand vorgemerkt – antworte mit dem Namen.", buttons: [] };
  }
  if ((aktion === "k" || aktion === "l") && ziel && /^[0-9a-f-]{36}$/.test(ziel)) return zuordnen(b.id, aktion, ziel);
  return { text: "Knopf veraltet.", buttons: [] };
}
