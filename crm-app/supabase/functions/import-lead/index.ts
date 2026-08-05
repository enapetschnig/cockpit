import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // API Key check
    const webhookKey = req.headers.get("x-webhook-key");
    const expectedKey = Deno.env.get("WEBHOOK_API_KEY");
    if (!expectedKey || webhookKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // Extract fields from Make.com payload
    const fullName = body.full_name || body.name || "";
    const phone = body.phone || body.p || "";
    const companyName = body.company_name || body.company || "";
    const source = body.source || (body.platform === "ig" ? "instagram" : "facebook");
    const platform = body.platform === "ig" ? "instagram" : (body.platform || "facebook");
    const campaignName = body.campaign_name || body.campaign || "";
    const adName = body.ad_name || body.ad || "";
    const isEntrepreneur = body.is_entrepreneur ?? null;
    const hasMoreThan5 = body.has_more_than_5_employees ?? null;
    const createdAt = body.created_at || new Date().toISOString();
    const userId = body.user_id || "cc3bb025-6463-40dd-8615-bf9eaab01783";

    if (!fullName) {
      return new Response(JSON.stringify({ error: "full_name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI Qualification
    let aiStage = "new";
    let aiIsEntrepreneur = isEntrepreneur;
    let aiHasMore5 = hasMoreThan5;
    let qualificationNotes = "";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY) {
      try {
        const aiResponse = await fetch(
          "https://ai.gateway.lovable.dev/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                {
                  role: "system",
                  content: `Du bist ein Lead-Qualifizierungs-Assistent für ein CRM das Handwerksbetriebe als Kunden gewinnen will. 
Analysiere die Lead-Daten und bestimme:
1. is_entrepreneur: Ist die Person wahrscheinlich ein Unternehmer/Selbstständiger? (true/false)
2. has_more_than_5_employees: Hat der Betrieb wahrscheinlich mehr als 5 Mitarbeiter? (true/false) 
3. stage: Welche Pipeline-Stufe passt? Optionen: "new", "qualified", "unqualified"
4. notes: Kurze Begründung (1-2 Sätze)

Hinweise:
- Wenn der Firmenname auf GmbH, e.U., OG etc. endet, ist es wahrscheinlich ein Unternehmer
- Begriffe wie "Selbstständig" deuten auf Einzelunternehmer hin
- Wenn Mitarbeiterzahl explizit angegeben ist (z.B. "50+_mitarbeiter", "10-20_mitarbeiter"), nutze diese Info
- Handwerksbetriebe (Elektro, Bau, KFZ, Tischlerei etc.) sind qualifizierte Leads`,
                },
                {
                  role: "user",
                  content: `Lead-Daten:
Name: ${fullName}
Firma: ${companyName}
Telefon: ${phone}
Plattform: ${platform}
Kampagne: ${campaignName}
Anzeige: ${adName}
Unternehmer: ${isEntrepreneur !== null ? isEntrepreneur : "unbekannt"}
Mitarbeiter >5: ${hasMoreThan5 !== null ? hasMoreThan5 : "unbekannt"}
Zusätzliche Infos: ${body.employees_info || body.additional_info || "keine"}`,
                },
              ],
              tools: [
                {
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
                },
              ],
              tool_choice: { type: "function", function: { name: "qualify_lead" } },
            }),
          }
        );

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall?.function?.arguments) {
            const args = JSON.parse(toolCall.function.arguments);
            aiStage = args.stage || "new";
            aiIsEntrepreneur = args.is_entrepreneur ?? aiIsEntrepreneur;
            aiHasMore5 = args.has_more_than_5_employees ?? aiHasMore5;
            qualificationNotes = args.notes || "";
          }
        } else {
          console.error("AI qualification failed:", aiResponse.status, await aiResponse.text());
        }
      } catch (aiErr) {
        console.error("AI qualification error:", aiErr);
      }
    }

    // Insert into DB using service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase.from("leads").insert({
      user_id: userId,
      full_name: fullName,
      phone,
      company_name: companyName || null,
      source,
      platform,
      stage: aiStage,
      campaign_name: campaignName || null,
      ad_name: adName || null,
      is_entrepreneur: aiIsEntrepreneur,
      has_more_than_5_employees: aiHasMore5,
      qualification_notes: qualificationNotes || null,
      created_at: createdAt,
    }).select().single();

    if (error) {
      console.error("DB insert error:", error);
      return new Response(JSON.stringify({ error: "Failed to insert lead", details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        lead: { id: data.id, full_name: data.full_name, stage: data.stage },
        qualification: { stage: aiStage, is_entrepreneur: aiIsEntrepreneur, has_more_than_5: aiHasMore5, notes: qualificationNotes },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("import-lead error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
