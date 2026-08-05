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
  name: "get_lead",
  title: "Get lead",
  description: "Fetch one lead by id, including its contact logs.",
  inputSchema: { id: z.string().uuid().describe("Lead UUID.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const client = db(ctx);
    const { data: lead, error } = await client.from("leads").select("*").eq("id", id).maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!lead) return { content: [{ type: "text", text: "Lead not found" }], isError: true };
    const { data: logs } = await client.from("contact_logs").select("*").eq("lead_id", id).order("date", { ascending: false });
    const payload = { lead, contact_logs: logs ?? [] };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  },
});
