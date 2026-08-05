import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function db(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_leads",
  title: "List leads",
  description: "List leads from the CRM, optionally filtered by stage and/or a text search across name, company, phone.",
  inputSchema: {
    stage: z.enum(["new", "qualified", "unqualified", "contacted", "meeting", "won", "lost"]).optional().describe("Filter by pipeline stage."),
    search: z.string().optional().describe("Case-insensitive substring match on full_name, company_name or phone."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ stage, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = db(ctx).from("leads").select("id, full_name, company_name, phone, email, stage, source, platform, campaign_name, created_at, callback_date, offer_id").order("created_at", { ascending: false }).limit(limit ?? 50);
    if (stage) q = q.eq("stage", stage);
    if (search) {
      const s = `%${search}%`;
      q = q.or(`full_name.ilike.${s},company_name.ilike.${s},phone.ilike.${s}`);
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { leads: data ?? [] } };
  },
});
