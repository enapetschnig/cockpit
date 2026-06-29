/**
 * Supabase-Admin-Client (Service-Role) zum Anlegen/Verwalten von Auth-Nutzern.
 * NUR serverseitig in Admin-Routen verwenden – der Service-Role-Key hat volle Rechte.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";

export async function supabaseAdmin(): Promise<SupabaseClient> {
  const url = (await getConfig("SUPABASE_URL")) || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = (await getConfig("SUPABASE_SERVICE_ROLE_KEY")) || "";
  if (!url || !key) throw new Error("Supabase Service-Role nicht konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unter /connect).");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Legt einen Kunden-Login an (oder aktualisiert ihn) und gibt die user.id zurück. */
export async function createCustomerUser(email: string, password: string): Promise<string> {
  const sb = await supabaseAdmin();
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "customer" } });
  if (!created.error && created.data.user) return created.data.user.id;
  // existiert schon → finden + aktualisieren
  const list = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const u = list.data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(created.error?.message || "Nutzer konnte nicht angelegt werden.");
  await sb.auth.admin.updateUserById(u.id, { password, app_metadata: { role: "customer" }, email_confirm: true });
  return u.id;
}
