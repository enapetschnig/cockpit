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

export interface CrmSyncResult { account: string; found: number; created: number; linked?: number; note?: string }

/** Synct ein Werbekonto in das CRM. `sinceDays` begrenzt auf frische Leads. */
export async function syncAdLeadsToCrm(metaAccountId: string, ownerUserId: string, sinceDays = 30): Promise<CrmSyncResult> {
  const acc = await prisma.adAccount.findUnique({ where: { metaAccountId } });
  if (!acc?.tokenCipher) return { account: metaAccountId, found: 0, created: 0, note: "kein Token" };
  const token = await decryptToken(acc.tokenCipher);
  const sb = await crmClient();

  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const pagesRes = await fetch(`${G}/me/accounts?fields=id,name,access_token&limit=50&access_token=${token}`).then((r) => r.json());
  const pages = (pagesRes.data ?? []) as { id: string; access_token: string }[];

  const leads: (MetaLead & { form?: string })[] = [];
  for (const p of pages) {
    const formsRes = await fetch(`${G}/${p.id}/leadgen_forms?fields=id,name,leads_count&limit=100&access_token=${p.access_token}`)
      .then((r) => r.json()).catch(() => ({ data: [] }));
    for (const f of ((formsRes.data ?? []) as { id: string; name: string; leads_count?: number }[])) {
      if (!Number(f.leads_count)) continue;
      const filtering = encodeURIComponent(JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]));
      const res = await fetch(
        `${G}/${f.id}/leads?fields=id,created_time,field_data,ad_name,campaign_name,platform&limit=100&filtering=${filtering}&access_token=${p.access_token}`,
      ).then((r) => r.json()).catch(() => ({ data: [] }));
      for (const l of ((res.data ?? []) as MetaLead[])) leads.push({ ...l, form: f.name });
    }
  }
  if (!leads.length) return { account: acc.label, found: 0, created: 0 };

  // Dedup auf ZWEI Wegen:
  //  1) gleiche Meta-ID  → derselbe Lead
  //  2) gleiche Telefonnummer → dieselbe Person ist schon im CRM (auch aus der
  //     Zeit vor diesem Sync). Dann wird NICHT neu angelegt, sondern nur die
  //     Meta-ID nachgetragen, damit künftige Läufe ihn sicher erkennen.
  const ids = leads.map((l) => l.id);
  const { data: known } = await sb.from("leads").select("meta_lead_id").in("meta_lead_id", ids);
  const seen = new Set((known ?? []).map((k) => (k as { meta_lead_id: string }).meta_lead_id));

  const { data: bestand } = await sb.from("leads").select("id, phone, meta_lead_id").eq("user_id", ownerUserId);
  const byPhone = new Map<string, { id: string; meta_lead_id: string | null }>();
  for (const b of ((bestand ?? []) as { id: string; phone: string | null; meta_lead_id: string | null }[])) {
    const p = normPhone(b.phone);
    if (p) byPhone.set(p, { id: b.id, meta_lead_id: b.meta_lead_id });
  }

  let linked = 0;
  const fresh: typeof leads = [];
  for (const l of leads) {
    if (seen.has(l.id)) continue;
    const phone = normPhone(pick(l.field_data ?? [], "phone", "telefon"));
    const hit = phone ? byPhone.get(phone) : undefined;
    if (hit) {
      // Person schon im CRM – nur verknüpfen, Pipeline-Stufe NICHT anfassen
      if (!hit.meta_lead_id) {
        await sb.from("leads").update({ meta_lead_id: l.id }).eq("id", hit.id);
        linked++;
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
    const notes = [branche ? `Branche: ${branche}` : "", mitarbeiter ? `${mitarbeiter} Mitarbeiter` : "",
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
  if (!rows.length) return { account: acc.label, found: leads.length, created: 0, linked };

  // upsert auf meta_lead_id: parallele Läufe können nichts doppelt anlegen
  const { error, count } = await sb.from("leads")
    .upsert(rows, { onConflict: "meta_lead_id", ignoreDuplicates: true, count: "exact" });
  if (error) return { account: acc.label, found: leads.length, created: 0, linked, note: error.message };
  return { account: acc.label, found: leads.length, created: count ?? rows.length, linked };
}
