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
  name: "add_contact_log",
  title: "Add contact log",
  description: "Log a contact attempt (call, email, message) for a lead.",
  inputSchema: {
    lead_id: z.string().uuid(),
    type: z.string().describe("e.g. call, email, whatsapp"),
    reached_customer: z.boolean().optional(),
    comment: z.string().optional(),
    date: z.string().datetime().optional().describe("ISO timestamp; defaults to now."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await db(ctx).from("contact_logs").insert({
      lead_id: input.lead_id,
      type: input.type,
      reached_customer: input.reached_customer ?? null,
      comment: input.comment ?? null,
      ...(input.date ? { date: input.date } : {}),
    }).select().maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { log: data } };
  },
});
