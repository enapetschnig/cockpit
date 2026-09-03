/**
 * Holt neue Meta-Lead-Ads-Leads und legt sie automatisch im CRM
 * (Schema `crm`, Tabelle `leads`) in der Pipeline-Stufe „Neu" an.
 *
 * Dedup über `crm.leads.meta_lead_id` (eindeutiger Index) – ein Lead landet
 * also nie doppelt, egal wie oft der Sync läuft.
 */
import { createClient } from "@supabase/supabase-js";
import { prisma } from "./db";
import { decryptToken } from "./adsCrypto";
import { getConfig } from "./config";

const G = "https://graph.facebook.com/v25.0";

type FieldData = { name: string; values: string[] };
interface MetaLead {
  id: string;
  created_time: string;
  field_data?: FieldData[];
  ad_name?: string;
  campaign_name?: string;
  platform?: string;
}

async function crmClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || (await getConfig("SUPABASE_URL"));
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || (await getConfig("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) throw new Error("Supabase-Zugang (Service-Role) fehlt.");
  return createClient(url, key, { auth: { persistSession: false }, db: { schema: "crm" } });
}

/** Telefonnummer auf reine Ziffern reduzieren – für den Abgleich mit dem Bestand. */
const normPhone = (v?: string | null) => (v || '').replace(/\D/g, '').slice(-9);

const pick = (fd: FieldData[], ...keys: string[]) =>
  fd.find((f) => keys.some((k) => (f.name || "").toLowerCase().includes(k)))?.values?.[0]?.trim() || null;

/** „5-10", „50+ mitarbeiter" → true; „1-4", „ja_", leer → false */
function moreThanFive(v: string | null): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  if (/50\+|20\+|10-20|5-10|11|mehr/.test(s)) return true;
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) >= 5 : false;
}

export interface CrmSyncResult { account: string; found: number; created: number; linked?: number; repeats?: number; blocked?: number; note?: string }

/** Synct ein Werbekonto in das CRM. `sinceDays` begrenzt auf frische Leads. */
export async function syncAdLeadsToCrm(metaAccountId: string, ownerUserId: string, sinceDays = 30): Promise<CrmSyncResult> {
  const acc = await prisma.adAccount.findUnique({ where: { metaAccountId } });
  if (!acc?.tokenCipher) return { account: metaAccountId, found: 0, created: 0, note: "kein Token" };
  const token = await decryptToken(acc.tokenCipher);
  const sb = await crmClient();

  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;

  // Fehler dürfen NICHT stillschweigend zu "keine Leads" werden – genau so
  // sind Anfragen unbemerkt liegengeblieben. Jede Seite wird durchgeblättert,
  // jeder Fehler gezählt und im Ergebnis ausgewiesen.
  let fehler = 0;
  const alleSeiten = async <T,>(startUrl: string): Promise<T[]> => {
    const out: T[] = [];
    let url: string | null = startUrl;
    for (let i = 0; url && i < 30; i++) {
      try {
        const r = (await fetch(url).then((x) => x.json())) as { data?: T[]; paging?: { next?: string }; error?: { message?: string } };
        if (r.error) { fehler++; console.error("[crm-lead-sync] Meta:", r.error.message); break; }
        out.push(...(r.data ?? []));
        url = r.paging?.next ?? null;
      } catch (e) { fehler++; console.error("[crm-lead-sync]", e); break; }
    }
    return out;
  };

  const pages = await alleSeiten<{ id: string; access_token: string }>(
    `${G}/me/accounts?fields=id,name,access_token&limit=50&access_token=${token}`);

  const leads: (MetaLead & { form?: string })[] = [];
  for (const p of pages) {
    const forms = await alleSeiten<{ id: string; name: string; leads_count?: number }>(
      `${G}/${p.id}/leadgen_forms?fields=id,name,leads_count&limit=100&access_token=${p.access_token}`);
    for (const f of forms) {
      if (!Number(f.leads_count)) continue;
      const filtering = encodeURIComponent(JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]));
      const res = await alleSeiten<MetaLead>(
        `${G}/${f.id}/leads?fields=id,created_time,field_data,ad_name,campaign_name,platform&limit=100&filtering=${filtering}&access_token=${p.access_token}`);
      for (const l of res) leads.push({ ...l, form: f.name });
    }
  }
  if (!leads.length) {
    return { account: acc.label, found: 0, created: 0, note: fehler ? `${fehler} Meta-Fehler – Lauf unvollständig!` : undefined };
  }

  // Dedup auf ZWEI Wegen:
  //  1) gleiche Meta-ID  → derselbe Lead
  //  2) gleiche Telefonnummer → dieselbe Person ist schon im CRM (auch aus der
  //     Zeit vor diesem Sync). Dann wird NICHT neu angelegt, sondern nur die
  //     Meta-ID nachgetragen, damit künftige Läufe ihn sicher erkennen.
  const ids = leads.map((l) => l.id);
  const { data: known } = await sb.from("leads").select("meta_lead_id").in("meta_lead_id", ids);
  const seen = new Set((known ?? []).map((k) => (k as { meta_lead_id: string }).meta_lead_id));

  const { data: bestand } = await sb.from("leads")
    .select("id, phone, meta_lead_id, stage, qualification_notes, inquiry_count, last_inquiry_at, created_at").eq("user_id", ownerUserId);
  type Best = { id: string; phone: string | null; meta_lead_id: string | null; stage: string;
    qualification_notes: string | null; inquiry_count: number | null;
    last_inquiry_at: string | null; created_at: string };
  const byPhone = new Map<string, Best>();
  for (const b of ((bestand ?? []) as Best[])) {
    const p = normPhone(b.phone);
    if (p) byPhone.set(p, b);
  }
  // Stufen, in denen aktiv gearbeitet wird – die werden bei einer erneuten
  // Anfrage NICHT zurückgesetzt (sonst reißt man laufende Termine aus dem Ablauf).
  const AKTIV = new Set(["contacted", "meeting_scheduled", "meeting_done", "won", "follow_up"]);

  // Sperrliste: bewusst entfernte Leads bleiben draußen – aber nur deren ALTE
  // Anfragen. Meldet sich dieselbe Person NACH dem Sperren noch einmal über
  // die Werbung, ist das neues Interesse und kommt wieder herein (Entscheid
  // 31.08.2026: „alle Leads holen, auch die, die sich schon mal gemeldet haben").
  const { data: blocked } = await sb.from("lead_blocklist")
    .select("meta_lead_id, phone_norm, created_at").eq("user_id", ownerUserId);
  const blockIds = new Set<string>();
  const blockPhones = new Map<string, number>(); // Telefon → Zeitpunkt der Sperre
  for (const b of ((blocked ?? []) as { meta_lead_id: string | null; phone_norm: string | null; created_at: string }[])) {
    if (b.meta_lead_id) blockIds.add(b.meta_lead_id);
    if (b.phone_norm) {
      const ph9 = b.phone_norm.slice(-9);
      const t = new Date(b.created_at).getTime();
      blockPhones.set(ph9, Math.max(blockPhones.get(ph9) ?? 0, t));
    }
  }

  let linked = 0;
  let repeats = 0;
  let skippedBlocked = 0;
  const fresh: typeof leads = [];
  const rueckkehrer = new Set<string>(); // Telefonnummern: gesperrt, aber neu gemeldet
  for (const l of leads) {
    if (seen.has(l.id)) continue;
    const phone = normPhone(pick(l.field_data ?? [], "phone", "telefon"));
    if (blockIds.has(l.id)) { skippedBlocked++; continue; }
    const sperre = phone ? blockPhones.get(phone) : undefined;
    if (sperre !== undefined) {
      if (new Date(l.created_time).getTime() <= sperre) { skippedBlocked++; continue; }
      rueckkehrer.add(phone); // neue Anfrage NACH der Sperre → darf herein
    }
    const hit = phone ? byPhone.get(phone) : undefined;
    if (hit) {
      // Wiederkehr = eine Anfrage, die deutlich NACH der letzten bekannten liegt.
      // Die 24-Stunden-Spanne trennt echte Neu-Anfragen vom Nachverknüpfen der
      // ursprünglichen Einreichung (deren Zeiten weichen um Minuten ab).
      // WICHTIG: gilt auch für Alt-Leads OHNE Meta-Verknüpfung – genau dort
      // wurden Hofer und Kloiber am 02./03.09. stillschweigend verschluckt.
      const basis = new Date(hit.last_inquiry_at || hit.created_at).getTime();
      const wiederkehr = hit.meta_lead_id !== l.id
        && new Date(l.created_time).getTime() > basis + 24 * 3600 * 1000;
      if (!wiederkehr && !hit.meta_lead_id) {
        // dieselbe alte Anfrage → Meta-ID nachtragen, Stufe unangetastet lassen
        await sb.from("leads").update({ meta_lead_id: l.id, last_inquiry_at: l.created_time }).eq("id", hit.id);
        linked++;
      } else if (wiederkehr) {
        // ERNEUTE Anfrage derselben Person – das ist ein starkes Signal und
        // darf nicht lautlos verschwinden: Notiz ergänzen und (außer bei
        // laufender Bearbeitung) zurück in „Neu" holen.
        const datum = new Date(l.created_time).toLocaleDateString("de-AT");
        const hinweis = `Erneute Anfrage über die Werbung am ${datum}`;
        const notes = hit.qualification_notes?.includes(hinweis)
          ? hit.qualification_notes
          : [hinweis, hit.qualification_notes].filter(Boolean).join(" · ");
        await sb.from("leads").update({
          // neueste Meta-ID übernehmen → der nächste Lauf erkennt sie und
          // zählt die Anfrage NICHT erneut (sonst würde die Stufe immer wieder
          // auf „Neu" springen)
          meta_lead_id: l.id,
          qualification_notes: notes,
          last_inquiry_at: l.created_time,
          inquiry_count: (hit.inquiry_count ?? 1) + 1,
          ...(AKTIV.has(hit.stage) ? {} : { stage: "new" }),
        }).eq("id", hit.id);
        hit.meta_lead_id = l.id;
        hit.last_inquiry_at = l.created_time;
        hit.inquiry_count = (hit.inquiry_count ?? 1) + 1;
        repeats++;
      }
      continue;
    }
    fresh.push(l);
  }

  const rows = fresh.map((l) => {
    const fd = l.field_data ?? [];
    const branche = pick(fd, "branche");
    const mitarbeiter = pick(fd, "mitarbeiter");
    const chef = (pick(fd, "chef") || "").toLowerCase().startsWith("ja");
    const phone9 = normPhone(pick(fd, "phone", "telefon"));
    const notes = [
      phone9 && rueckkehrer.has(phone9) ? "ERNEUTE Anfrage – frühere Anfrage war bewusst entfernt worden" : "",
      branche ? `Branche: ${branche}` : "", mitarbeiter ? `${mitarbeiter} Mitarbeiter` : "",
      `Chef: ${chef ? "ja" : "nein"}`].filter(Boolean).join(" · ");
    const platform = l.platform === "ig" || l.platform === "instagram" ? "instagram" : "facebook";
    return {
      user_id: ownerUserId,
      meta_lead_id: l.id,
      full_name: pick(fd, "full_name", "name") || "(ohne Namen)",
      phone: pick(fd, "phone", "telefon"),
      email: pick(fd, "email", "mail"),
      company_name: pick(fd, "company", "firma"),
      stage: "new",
      source: platform,
      platform,
      ad_name: l.ad_name ?? l.form ?? null,
      campaign_name: l.campaign_name ?? null,
      form_name: l.form ?? null,
      is_entrepreneur: chef,
      has_more_than_5_employees: moreThanFive(mitarbeiter),
      qualification_notes: notes || null,
      created_at: l.created_time,
    };
  });
  if (!rows.length) return { account: acc.label, found: leads.length, created: 0, linked, repeats, blocked: skippedBlocked,
    note: fehler ? `${fehler} Meta-Fehler – Lauf womöglich unvollständig` : undefined };

  // upsert auf meta_lead_id: parallele Läufe können nichts doppelt anlegen
  const { error, count } = await sb.from("leads")
    .upsert(rows, { onConflict: "meta_lead_id", ignoreDuplicates: true, count: "exact" });
  if (error) return { account: acc.label, found: leads.length, created: 0, linked, repeats, blocked: skippedBlocked, note: error.message };
  return { account: acc.label, found: leads.length, created: count ?? rows.length, linked, repeats, blocked: skippedBlocked,
    note: fehler ? `${fehler} Meta-Fehler – Lauf womöglich unvollständig` : undefined };
}
