import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listLeads from "./tools/list-leads";
import getLead from "./tools/get-lead";
import updateLeadStage from "./tools/update-lead-stage";
import addContactLog from "./tools/add-contact-log";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "epower-crm-mcp",
  title: "epower CRM",
  version: "0.1.0",
  instructions: "Tools for the epower CRM: list and inspect leads, update pipeline stages, and log contact attempts. All calls run as the signed-in CRM user and respect RLS.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listLeads, getLead, updateLeadStage, addContactLog],
});
