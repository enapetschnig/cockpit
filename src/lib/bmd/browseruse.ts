/**
 * browser-use Cloud (v2) – dünner HTTP-Client.
 * Vercel-Serverless kann keinen Browser starten → wir starten einen Cloud-Browser-Task,
 * persistieren die taskId und pollen in späteren Cron-Ticks (nie blockierend warten).
 *
 * WICHTIG: vor dem Scharfschalten die exakten v2-Feldnamen gegen die Live-Referenz prüfen
 * (https://docs.browser-use.com / cloud). Secrets gehen NUR in den `secrets`-Param,
 * niemals in den Task-Text oder ins Log.
 */
import { getConfig } from "../config";

const BASE = "https://api.browser-use.com/api/v2";

export async function isBrowserUseConfigured(): Promise<boolean> {
  return Boolean(await getConfig("BROWSER_USE_API_KEY"));
}

async function headers(): Promise<Record<string, string>> {
  const key = await getConfig("BROWSER_USE_API_KEY");
  if (!key) throw new Error("browser-use nicht konfiguriert: BROWSER_USE_API_KEY fehlt (/connect → Einstellungen).");
  return { "Content-Type": "application/json", "X-Browser-Use-API-Key": key };
}

export interface StartTaskOpts {
  task: string;
  structuredOutput?: object;
  secrets?: Record<string, string>; // v2: flache Map Platzhalter→Wert (Domain-Scope via allowedDomains)
  allowedDomains?: string[];
  llm?: string;
  proxyCountryCode?: string;
}

/** Startet einen Cloud-Task; kehrt sofort mit der taskId zurück. */
export async function startTask(o: StartTaskOpts): Promise<{ taskId: string }> {
  const res = await fetch(`${BASE}/tasks`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({
      task: o.task,
      structured_output_json: o.structuredOutput,
      secrets: o.secrets,
      allowed_domains: o.allowedDomains,
      llm: o.llm,
      save_browser_data: true, // Cookies/Profil persistieren → Login wiederverwenden
      proxy_country_code: o.proxyCountryCode || "AT",
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; task_id?: string; detail?: string };
  if (!res.ok) throw new Error(`browser-use start (${res.status}): ${j.detail || "unbekannt"}`);
  const taskId = j.id || j.task_id;
  if (!taskId) throw new Error("browser-use: keine taskId erhalten");
  return { taskId };
}

export interface TaskStatus {
  raw: string; // Roh-Status von browser-use
  done: boolean; // terminal (finished|stopped)
  isSuccess: boolean | null;
  output: string | null;
  confirmation: string | null;
  error: string | null;
  liveUrl: string | null;
}

/** Pollt einen Task. Terminal = finished|stopped. Die liveUrl liegt auf Session-Ebene. */
export async function getTask(taskId: string): Promise<TaskStatus> {
  const h = await headers();
  const res = await fetch(`${BASE}/tasks/${encodeURIComponent(taskId)}`, { headers: h });
  const j = (await res.json().catch(() => ({}))) as {
    status?: string;
    output?: unknown;
    is_success?: boolean;
    isSuccess?: boolean;
    sessionId?: string;
  };
  if (!res.ok) throw new Error(`browser-use get (${res.status})`);
  const status = String(j.status || "").toLowerCase();
  const done = status === "finished" || status === "stopped";
  const isSuccess = (j.is_success ?? j.isSuccess) ?? null;

  // liveUrl kommt aus der Session (am Task ist sie null).
  let liveUrl: string | null = null;
  if (j.sessionId && !done) {
    try {
      const sr = await fetch(`${BASE}/sessions/${j.sessionId}`, { headers: h });
      if (sr.ok) liveUrl = ((await sr.json()) as { liveUrl?: string; live_url?: string }).liveUrl ?? null;
    } catch {
      /* liveUrl ist optional */
    }
  }

  // output kann strukturiertes JSON (als String oder Objekt) oder Freitext sein.
  let confirmation: string | null = null;
  let error: string | null = null;
  let outputStr: string | null = null;
  const out = j.output;
  if (out != null) {
    const obj = typeof out === "string" ? safeJson(out) : (out as Record<string, unknown>);
    if (obj && typeof obj === "object") {
      confirmation = strOrNull(obj.confirmation);
      error = strOrNull(obj.error);
      outputStr = typeof out === "string" ? out : JSON.stringify(out);
    } else {
      outputStr = String(out);
    }
  }
  return { raw: status, done, isSuccess, output: outputStr, confirmation, error, liveUrl };
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const BMD_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    uploaded: { type: "boolean" },
    confirmation: { type: "string" },
    error: { type: "string" },
  },
  required: ["uploaded"],
};

/**
 * Startet den BMD-Com-Upload eines Belegs. Login = nur Passwort (keine 2FA, lt. User).
 * Die PDF wird per Signed-URL übergeben; Zugangsdaten ausschließlich als domain-scoped secrets.
 */
export async function startBmdUpload(input: {
  pdfUrl: string;
  fileName: string;
  vendor: string;
  invoiceNumber?: string | null;
}): Promise<{ taskId: string }> {
  const [portalUrl, user, pass] = await Promise.all([
    getConfig("BMD_PORTAL_URL"),
    getConfig("BMD_PORTAL_USER"),
    getConfig("BMD_PORTAL_PASSWORD"),
  ]);
  if (!portalUrl || !user || !pass) {
    throw new Error("BMD nicht konfiguriert: BMD_PORTAL_URL / BMD_PORTAL_USER / BMD_PORTAL_PASSWORD fehlen.");
  }
  const customer = (await getConfig("BMD_PORTAL_CUSTOMER")) || user; // Kundennummer; default = Benutzer
  const host = hostOf(portalUrl);
  const task = [
    `Open ${portalUrl} and log in to the BMD Com web portal.`,
    `The login form may have separate fields for customer/Kundennummer/Mandant/Datenbank, user/Benutzer and password/Kennwort.`,
    `Fill the Kundennummer/Mandant field with bmd_customer, the Benutzer field with bmd_user, and the Kennwort/Passwort field with bmd_pass. If there is only a user and a password field, use bmd_user and bmd_pass.`,
    `After login, navigate to the document/Beleg upload area (e.g. "Belege", "Belegscanner", "Eingangsrechnungen", "Upload").`,
    `Download the invoice PDF from this URL: ${input.pdfUrl} and upload it as a new Beleg/document.`,
    `It is an invoice from ${input.vendor}${input.invoiceNumber ? ` (number ${input.invoiceNumber})` : ""}, file name "${input.fileName}".`,
    `Submit/confirm the upload. Then read back any confirmation number or success message shown by BMD.`,
    `Return JSON {"uploaded": true/false, "confirmation": "<number or text>", "error": "<reason if failed>"}.`,
  ].join(" ");

  return startTask({
    task,
    structuredOutput: BMD_OUTPUT_SCHEMA,
    secrets: { bmd_customer: customer, bmd_user: user, bmd_pass: pass },
    allowedDomains: [host, `*.${host}`],
    llm: "claude-sonnet-4-6",
  });
}

function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const parts = h.split(".");
    return parts.length > 2 ? parts.slice(-2).join(".") : h; // bmd.com
  } catch {
    return "bmd.com";
  }
}
