/**
 * Lead-Eingang für das CRM (Schema `crm`, Projekt epowergmbh).
 *
 * Nimmt Leads von Make.com (Meta-Formulare) und von der Website epowergmbh.at
 * entgegen. Abgesichert über den Header `x-webhook-key` = Secret WEBHOOK_API_KEY.
 *
 * Website-Fall: source/platform "website", campaign_name = Formular
 * (quiz | termin-ki-assistent | website), additional_info = Freitext wie
 * "Mitarbeiter: 10-20 | Chef: ja | Gewerk: Holzbau".
 *
 * Regeln:
 * - is_entrepreneur / has_more_than_5_employees: geliefertes true/false hat
 *   Vorrang, bei null entscheidet die KI-Qualifizierung.
 * - Dedup: gleiche Telefonnummer innerhalb von 24 Stunden → kein zweiter Lead,
 *   sondern ein contact_log (type "website"/"facebook"…) am bestehenden.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Wem die Pipeline gehört – Make und Website haben keinen eigenen Login.
const OWNER_DEFAULT = "83edc9c7-26a7-4f56-8806-cdfe253b9751";
const DEDUP_STUNDEN = 24;

const cut = (v: unknown, n: number): string => (v ?? "").toString().trim().slice(0, n);
const normPhone = (v: string) => v.replace(/\D/g, "").slice(-9);
/** true/false bleibt, alles andere (null, "", undefined) heißt „unbekannt". */
const tri = (v: unknown): boolean | null =>
  v === true || v === "true" ? true : v === false || v === "false" ? false : null;

interface KiErgebnis { is_entrepreneur: boolean; has_more_than_5_employees: boolean; stage: string; notes: string }

/**
 * KI-Qualifizierung – OpenAI, falls konfiguriert, sonst Lovable-Gateway.
 * Fällt still auf null zurück; ein Lead darf daran nie scheitern.
 */
async function qualifiziere(daten: string): Promise<KiErgebnis | null> {
  const system =
    `Du bist ein Lead-Qualifizierungs-Assistent für ein CRM, das Handwerksbetriebe als Kunden gewinnt.
Analysiere die Lead-Daten und bestimme:
1. is_entrepreneur: Ist die Person wahrscheinlich Unternehmer/Selbstständiger? (true/false)
2. has_more_than_5_employees: Hat der Betrieb wahrscheinlich mehr als 5 Mitarbeiter? (true/false)
3. stage: "new", "qualified" oder "unqualified"
4. notes: kurze Begründung (1-2 Sätze, Deutsch)

Hinweise:
- Firmenname mit GmbH, e.U., OG usw. → wahrscheinlich Unternehmer
- „Chef: ja" oder „Selbstständig" → Unternehmer
- Mitarbeiterangaben wie "10-20", "50+" nutzen
- Handwerksbetriebe (Holzbau, Elektro, Bau, KFZ, Tischlerei …) sind qualifizierte Leads`;
  const tool = {
    type: "function",
    function: {
      name: "qualify_lead",
      description: "Qualifiziere den Lead basierend auf den Daten",
      parameters: {
        type: "object",
        properties: {
          is_entrepreneur: { type: "boolean" },
          has_more_than_5_employees: { type: "boolean" },
          stage: { type: "string", enum: ["new", "qualified", "unqualified"] },
          notes: { type: "string" },
        },
        required: ["is_entrepreneur", "has_more_than_5_employees", "stage", "notes"],
        additionalProperties: false,
      },
    },
  };
  const openai = Deno.env.get("OPENAI_API_KEY");
  const lovable = Deno.env.get("LOVABLE_API_KEY");
  const ziel = openai
    ? { url: "https://api.openai.com/v1/chat/completions", key: openai, model: "gpt-4o-mini" }
    : lovable
    ? { url: "https://ai.gateway.lovable.dev/v1/chat/completions", key: lovable, model: "google/gemini-3-flash-preview" }
    : null;
  if (!ziel) return null;
  try {
    const r = await fetch(ziel.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ziel.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ziel.model,
        messages: [{ role: "system", content: system }, { role: "user", content: daten }],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "qualify_lead" } },
      }),
    });
    if (!r.ok) { console.error("KI-Qualifizierung fehlgeschlagen:", r.status, await r.text()); return null; }
    const d = await r.json();
    const args = d.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    return args ? (JSON.parse(args) as KiErgebnis) : null;
  } catch (e) {
    console.error("KI-Qualifizierung Fehler:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "nur POST" }, 405);

  try {
    const expected = Deno.env.get("WEBHOOK_API_KEY");
    if (!expected || req.headers.get("x-webhook-key") !== expected) return json({ error: "Unauthorized" }, 401);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Body ist kein gültiges JSON" }, 400); }

    // ── Felder (Make.com und Website liefern leicht unterschiedliche Namen)
    const fullName = cut(body.full_name ?? body.name, 120);
    const phone = cut(body.phone ?? body.p, 40);
    const email = cut(body.email, 120).toLowerCase();
    const companyName = cut(body.company_name ?? body.company, 160);
    const platformRoh = cut(body.platform, 30).toLowerCase();
    const platform = platformRoh === "ig" ? "instagram" : platformRoh || "facebook";
    const source = cut(body.source, 30).toLowerCase() || (platform === "instagram" ? "instagram" : "facebook");
    const campaignName = cut(body.campaign_name ?? body.campaign, 160);
    const adName = cut(body.ad_name ?? body.ad, 160);
    const additionalInfo = cut(body.additional_info ?? body.employees_info, 1000);
    const geliefertUnternehmer = tri(body.is_entrepreneur);
    const geliefertMehrAls5 = tri(body.has_more_than_5_employees);
    const createdAt = (() => { const d = new Date(cut(body.created_at, 40)); return isNaN(d.getTime()) ? new Date() : d; })().toISOString();
    const userId = cut(body.user_id, 40) || Deno.env.get("CRM_OWNER_USER_ID") || OWNER_DEFAULT;
    const istWebsite = source === "website";

    if (!fullName) return json({ error: "full_name is required" }, 400);
    if (!phone && !email) return json({ error: "phone or email is required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "crm" }, auth: { persistSession: false },
    });

    // ── Dedup: gleiche Nummer in den letzten 24 Stunden → nur ein Kontakt-Eintrag
    const tel9 = normPhone(phone);
    if (tel9) {
      const seit = new Date(Date.now() - DEDUP_STUNDEN * 3600_000).toISOString();
      const { data: kandidaten } = await supabase.from("leads")
        .select("id, phone, full_name, inquiry_count, email")
        .eq("user_id", userId).gte("created_at", seit).order("created_at", { ascending: false }).limit(200);
      const doppelt = (kandidaten ?? []).find((k: { phone: string | null }) => normPhone(k.phone || "") === tel9);
      if (doppelt) {
        const kommentar = [
          `${istWebsite ? "Website" : platform}${campaignName ? ` (${campaignName})` : ""}: erneut gemeldet`,
          additionalInfo,
        ].filter(Boolean).join(" – ");
        await supabase.from("contact_logs").insert({
          lead_id: doppelt.id, date: createdAt, type: istWebsite ? "website" : source, comment: kommentar, reached_customer: false,
        });
        await supabase.from("leads").update({
          last_inquiry_at: createdAt, inquiry_count: (doppelt.inquiry_count ?? 1) + 1, updated_at: createdAt,
          ...(email && !doppelt.email ? { email } : {}),
        }).eq("id", doppelt.id);
        return json({ success: true, duplicate: true, lead: { id: doppelt.id, full_name: doppelt.full_name } });
      }
    }

    // ── Keine automatische Einstufung: jeder Lead landet als "new" in der Pipeline.
    // Chef entscheidet selbst. Die Felder werden so übernommen, wie das Formular sie liefert.
    const isEntrepreneur = geliefertUnternehmer;
    const hasMoreThan5 = geliefertMehrAls5;
    const stage = "new";
    const kiNotiz = "";

    const notizen = [
      istWebsite ? `Anfrage über die Website${campaignName ? ` (${campaignName})` : ""}` : "",
      additionalInfo,
      kiNotiz,
    ].filter(Boolean).join("\n");

    const { data, error } = await supabase.from("leads").insert({
      user_id: userId,
      full_name: fullName,
      phone: phone || null,
      email: email || null,
      company_name: companyName || null,
      source,
      platform,
      stage,
      campaign_name: campaignName || null,
      ad_name: adName || null,
      form_name: istWebsite ? `Website ${campaignName || ""}`.trim() : null,
      is_entrepreneur: isEntrepreneur ?? false,
      has_more_than_5_employees: hasMoreThan5 ?? false,
      qualification_notes: notizen || null,
      last_inquiry_at: createdAt,
      inquiry_count: 1,
      created_at: createdAt,
    }).select("id, full_name, stage").single();

    if (error) {
      console.error("DB insert error:", error);
      return json({ error: "Failed to insert lead", details: error.message }, 500);
    }

    return json({
      success: true,
      lead: data,
      qualification: { stage, is_entrepreneur: isEntrepreneur, has_more_than_5: hasMoreThan5, notes: kiNotiz || null },
    });
  } catch (e) {
    console.error("import-lead error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
