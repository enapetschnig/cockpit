"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Acc = { account: "firma" | "privat"; email: string | null; connected: boolean; lastSyncAt: string | null };
type Status = { configured: boolean; accounts: Acc[]; error?: string };

const LABEL: Record<string, string> = { firma: "Firma", privat: "Privat" };

export default function ConnectPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [reclassing, setReclassing] = useState(false);
  const [reclassMsg, setReclassMsg] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgMsg, setTgMsg] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, { set: boolean; source: string | null; hint: string }>>({});
  const [keyOrder, setKeyOrder] = useState<string[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [adAccts, setAdAccts] = useState<{ id: string; label: string; metaAccountId: string; accountName: string | null; status: string; hasToken: boolean; lastError: string | null }[]>([]);
  const [adForm, setAdForm] = useState({ label: "", metaAccountId: "", token: "", pageId: "" });
  const [customers, setCustomers] = useState<{ accountLabel: string; metaAccountId: string; email: string | null }[]>([]);
  const [custForm, setCustForm] = useState({ email: "", password: "", label: "", metaAccountId: "", token: "", pageId: "" });
  const [custBusy, setCustBusy] = useState(false);
  const [custMsg, setCustMsg] = useState<string | null>(null);
  const [adBusy, setAdBusy] = useState(false);
  const [adMsg, setAdMsg] = useState<string | null>(null);

  async function loadSettings() {
    try {
      const r = await fetch("/api/settings");
      const d = await r.json();
      setSettings(d.status || {});
      setKeyOrder(d.keys || []);
    } catch {
      /* ignore */
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json();
      setSettings(d.status || {});
      setForm({});
      setSettingsMsg(d.saved?.length ? `Gespeichert: ${d.saved.join(", ")}` : "Nichts geändert (leere Felder werden ignoriert).");
      loadStatus();
    } catch (e) {
      setSettingsMsg("Fehlgeschlagen: " + (e as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function loadStatus() {
    try {
      const r = await fetch("/api/gmail/status");
      setStatus(await r.json());
    } catch {
      setStatus({ configured: false, accounts: [], error: "Status nicht ladbar" });
    }
  }

  async function loadAdAccounts() {
    try {
      const r = await fetch("/api/ads");
      const d = await r.json();
      setAdAccts(d.accounts || []);
    } catch {
      /* ignore */
    }
  }

  async function loadCustomers() {
    try {
      const d = await (await fetch("/api/admin/users")).json();
      setCustomers(d.customers || []);
    } catch {
      /* ignore */
    }
  }
  async function createCustomer() {
    if (!custForm.email.trim() || custForm.password.length < 6 || !custForm.metaAccountId.trim() || !custForm.token.trim()) {
      setCustMsg("E-Mail, Passwort (min. 6), Konto-ID (act_…) und Token sind nötig.");
      return;
    }
    setCustBusy(true);
    setCustMsg(null);
    try {
      const d = await (await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(custForm) })).json();
      if (d.ok) {
        setCustMsg(`✅ ${d.email} angelegt und mit „${d.accountLabel}" verbunden. Der Kunde kann sich jetzt einloggen.`);
        setCustForm({ email: "", password: "", label: "", metaAccountId: "", token: "", pageId: "" });
        loadCustomers();
        loadAdAccounts();
      } else {
        setCustMsg("❌ " + (d.error || "Anlegen fehlgeschlagen"));
      }
    } catch (e) {
      setCustMsg("Fehlgeschlagen: " + (e as Error).message);
    } finally {
      setCustBusy(false);
    }
  }

  async function connectAd() {
    if (!adForm.metaAccountId.trim() || !adForm.token.trim()) {
      setAdMsg("Konto-ID (act_…) und Access-Token sind nötig.");
      return;
    }
    setAdBusy(true);
    setAdMsg(null);
    try {
      const r = await fetch("/api/ads/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(adForm) });
      const d = await r.json();
      if (d.ok) {
        setAdMsg(`✅ ${d.account.label} verbunden${d.account.accountName ? ` (${d.account.accountName})` : ""}.`);
        setAdForm({ label: "", metaAccountId: "", token: "", pageId: "" });
        loadAdAccounts();
      } else {
        setAdMsg("❌ " + (d.error || "Verbinden fehlgeschlagen"));
      }
    } catch (e) {
      setAdMsg("Fehlgeschlagen: " + (e as Error).message);
    } finally {
      setAdBusy(false);
    }
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("connected")) {
      const email = q.get("email");
      setBanner({ kind: "ok", text: `${LABEL[q.get("connected")!] ?? q.get("connected")} verbunden${email ? ` (${email})` : ""}.` });
    } else if (q.get("error")) {
      setBanner({ kind: "err", text: `Fehler: ${q.get("error")}` });
    }
    window.history.replaceState({}, "", "/connect");
    loadStatus();
    loadSettings();
    loadAdAccounts();
    loadCustomers();
  }, []);

  const KEY_LABEL: Record<string, string> = {
    OPENAI_API_KEY: "OpenAI API-Key",
    OPENAI_MODEL: "OpenAI Modell (z. B. gpt-4o-mini)",
    GOOGLE_CLIENT_ID: "Google Client-ID",
    GOOGLE_CLIENT_SECRET: "Google Client-Secret",
    TELEGRAM_BOT_TOKEN: "Telegram Bot-Token",
    TELEGRAM_CHAT_ID: "Telegram Chat-ID",
    ADS_TOKEN_KEY: "Werbeanzeigen: Token-Schlüssel (zufälliger langer Wert)",
    SUPABASE_URL: "Buchhaltung: Supabase Projekt-URL",
    SUPABASE_SERVICE_ROLE_KEY: "Buchhaltung: Supabase Service-Role-Key (Storage)",
    BROWSER_USE_API_KEY: "Buchhaltung: browser-use Cloud API-Key (BMD-Upload)",
    BMD_PORTAL_URL: "Buchhaltung: BMD-Portal Login-URL",
    BMD_PORTAL_CUSTOMER: "Buchhaltung: BMD Kundennummer/Mandant",
    BMD_PORTAL_USER: "Buchhaltung: BMD-Portal Benutzer",
    BMD_PORTAL_PASSWORD: "Buchhaltung: BMD-Portal Passwort",
  };

  async function logout() {
    await supabaseBrowser().auth.signOut().catch(() => {});
    window.location.href = "/login";
  }

  async function sync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch("/api/gmail/sync", { method: "POST" });
      const d = await r.json();
      if (!r.ok) setSyncMsg(d.error || "Sync fehlgeschlagen");
      else {
        const parts = Object.entries(d.perAccount || {}).map(([a, n]) => `${LABEL[a] ?? a}: ${n}`);
        setSyncMsg(`${d.imported} neue Mail(s) importiert. ${parts.join(" · ")}${(d.errors || []).length ? " · Fehler: " + d.errors.join("; ") : ""}`);
      }
    } catch (e) {
      setSyncMsg("Sync fehlgeschlagen: " + (e as Error).message);
    } finally {
      setSyncing(false);
      loadStatus();
    }
  }

  async function reclassifyAll() {
    setReclassing(true);
    setReclassMsg(null);
    try {
      const r = await fetch("/api/classify/all", { method: "POST" });
      const d = await r.json();
      if (!r.ok) setReclassMsg(d.error || "Neu-Einordnen fehlgeschlagen");
      else setReclassMsg(`${d.updated} von ${d.total} Mails neu mit KI eingeordnet.${(d.errors || []).length ? " Fehler: " + d.errors.length : ""}`);
    } catch (e) {
      setReclassMsg("Fehlgeschlagen: " + (e as Error).message);
    } finally {
      setReclassing(false);
    }
  }

  async function detectCustomers() {
    setDetecting(true);
    setDetectMsg(null);
    try {
      const r = await fetch("/api/customers/detect", { method: "POST" });
      const d = await r.json();
      if (!r.ok) setDetectMsg(d.error || "Erkennung fehlgeschlagen");
      else setDetectMsg(`${d.created} Kunde(n) angelegt, ${d.assigned} Mail(s) zugeordnet${d.customers?.length ? ": " + d.customers.join(", ") : "."}`);
    } catch (e) {
      setDetectMsg("Fehlgeschlagen: " + (e as Error).message);
    } finally {
      setDetecting(false);
    }
  }

  async function activateBot() {
    setTgBusy(true);
    setTgMsg(null);
    try {
      const r = await fetch("/api/telegram/setup", { method: "POST" });
      const d = await r.json();
      if (!r.ok) setTgMsg(d.error || "Aktivierung fehlgeschlagen");
      else setTgMsg("✅ Bot aktiv. Antworte im Telegram-Chat auf eine Mail-Benachrichtigung (Text/Sprache).");
    } catch (e) {
      setTgMsg("Fehlgeschlagen: " + (e as Error).message);
    } finally {
      setTgBusy(false);
    }
  }

  const card: React.CSSProperties = { background: "#fff", border: "1px solid #ece8e0", borderRadius: 14, padding: 18, marginBottom: 14 };
  const btn: React.CSSProperties = { display: "inline-block", padding: "10px 16px", borderRadius: 10, border: "none", fontWeight: 700, cursor: "pointer", fontSize: 14 };
  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: "1px solid #ddd6cb", fontSize: 14 };

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "28px 18px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#2b2723" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <a href="/" style={{ color: "#6b6358", textDecoration: "none", fontSize: 14 }}>‹ Zum Cockpit</a>
        <button onClick={logout} style={{ background: "none", border: "none", color: "#6b6358", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>Abmelden</button>
      </div>
      <h1 style={{ fontSize: 24, margin: "12px 0 4px" }}>Gmail verbinden</h1>
      <p style={{ color: "#6b6358", marginTop: 0 }}>
        Verbinde Firmen- und Privat-Postfach. Danach holt „Synchronisieren" neue Mails und die KI ordnet sie ein.
        Anleitung: <code>docs/09-gmail-anbindung.md</code>.
      </p>

      {banner && (
        <div style={{ ...card, background: banner.kind === "ok" ? "#eaf6ee" : "#fdecea", borderColor: banner.kind === "ok" ? "#bfe6cb" : "#f5c6c0" }}>
          {banner.text}
        </div>
      )}

      {status && !status.configured && (
        <div style={{ ...card, background: "#fff7e6", borderColor: "#f0dca8" }}>
          <b>Noch nicht konfiguriert.</b> Trage unten unter <b>Einstellungen</b> die
          <code> Google Client-ID</code> und das <code>Client-Secret</code> ein. Anleitung:
          <code> docs/anleitung-gmail-einrichten.md</code>.
        </div>
      )}

      {(status?.accounts ?? [{ account: "firma", email: null, connected: false, lastSyncAt: null }, { account: "privat", email: null, connected: false, lastSyncAt: null }]).map((a) => (
        <div key={a.account} style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{LABEL[a.account]}-Postfach</div>
              <div style={{ color: "#6b6358", fontSize: 13 }}>
                {a.connected ? `verbunden${a.email ? ` · ${a.email}` : ""}` : "nicht verbunden"}
              </div>
            </div>
            <a href={`/api/gmail/connect?account=${a.account}`} style={{ ...btn, background: a.connected ? "#efece6" : "#2f6df0", color: a.connected ? "#2b2723" : "#fff", textDecoration: "none" }}>
              {a.connected ? "Neu verbinden" : "Verbinden"}
            </a>
          </div>
        </div>
      ))}

      <button onClick={sync} disabled={syncing} style={{ ...btn, background: "#1f9d63", color: "#fff", width: "100%", marginTop: 4, opacity: syncing ? 0.6 : 1 }}>
        {syncing ? "Synchronisiere …" : "Jetzt synchronisieren"}
      </button>
      {syncMsg && <p style={{ color: "#6b6358", fontSize: 14, marginTop: 10 }}>{syncMsg}</p>}

      <p style={{ color: "#8a8175", fontSize: 12.5, marginTop: 8 }}>
        🔄 Auto-Sync läuft im Hintergrund (alle ~2 Min), solange die App läuft — neue
        firmenrelevante Mails werden per Telegram gepusht (sofern eingerichtet).
      </p>

      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>KI-Einordnung</div>
        <div style={{ color: "#6b6358", fontSize: 13, marginBottom: 10 }}>
          Ordnet alle vorhandenen Mails einmal frisch mit der KI ein (Zusammenfassung, Labels, Firmenrelevanz).
        </div>
        <button onClick={reclassifyAll} disabled={reclassing} style={{ ...btn, background: "#2f6df0", color: "#fff", width: "100%", opacity: reclassing ? 0.6 : 1 }}>
          {reclassing ? "Ordne neu ein … (kann 1–2 Min dauern)" : "Alle mit KI neu einordnen"}
        </button>
        {reclassMsg && <p style={{ color: "#6b6358", fontSize: 14, marginTop: 10 }}>{reclassMsg}</p>}
      </div>

      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Kunden erkennen</div>
        <div style={{ color: "#6b6358", fontSize: 13, marginBottom: 10 }}>
          Findet aus deinen firmenrelevanten Mails echte Kunden (Handwerksbetriebe), legt sie an und ordnet ihre Mails zu — Dienste, Lieferanten &amp; Newsletter werden ignoriert.
        </div>
        <button onClick={detectCustomers} disabled={detecting} style={{ ...btn, background: "#d8932a", color: "#fff", width: "100%", opacity: detecting ? 0.6 : 1 }}>
          {detecting ? "Analysiere Mails …" : "Kunden aus Mails erkennen & anlegen"}
        </button>
        {detectMsg && <p style={{ color: "#6b6358", fontSize: 14, marginTop: 10 }}>{detectMsg}</p>}
      </div>

      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Telegram-Bot</div>
        <div style={{ color: "#6b6358", fontSize: 13, marginBottom: 10 }}>
          Antworte im Telegram-Chat auf eine Mail-Benachrichtigung (Text oder 🎤 Sprache) → die KI formuliert
          eine Antwort, du kontrollierst sie und sendest per Klick. Funktioniert nur online (Vercel) – localhost erreicht Telegram nicht.
        </div>
        <button onClick={activateBot} disabled={tgBusy} style={{ ...btn, background: "#1c8a90", color: "#fff", width: "100%", opacity: tgBusy ? 0.6 : 1 }}>
          {tgBusy ? "Aktiviere …" : "Telegram-Bot aktivieren"}
        </button>
        {tgMsg && <p style={{ color: "#6b6358", fontSize: 14, marginTop: 10 }}>{tgMsg}</p>}
      </div>

      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Einstellungen (Keys)</div>
        <div style={{ color: "#6b6358", fontSize: 13, marginBottom: 12 }}>
          Werden sicher in Supabase gespeichert (nicht im Code). Leeres Feld = unverändert.
        </div>
        {keyOrder.map((k) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontSize: 12.5, color: "#6b6358", marginBottom: 4 }}>
              {KEY_LABEL[k] ?? k}
              {settings[k]?.set
                ? ` · gesetzt (${settings[k].hint}${settings[k].source === "env" ? ", aus .env" : ""})`
                : " · nicht gesetzt"}
            </label>
            <input
              type={k.includes("MODEL") || k.includes("CHAT_ID") ? "text" : "password"}
              value={form[k] ?? ""}
              placeholder={settings[k]?.set ? "•••••• (gesetzt – leer = behalten)" : "eintragen …"}
              onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: "1px solid #ddd6cb", fontSize: 14 }}
            />
          </div>
        ))}
        <button onClick={saveSettings} disabled={savingSettings} style={{ ...btn, background: "#5a6675", color: "#fff", width: "100%", marginTop: 4, opacity: savingSettings ? 0.6 : 1 }}>
          {savingSettings ? "Speichere …" : "Einstellungen speichern"}
        </button>
        {settingsMsg && <p style={{ color: "#6b6358", fontSize: 14, marginTop: 10 }}>{settingsMsg}</p>}
      </div>

      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Werbekonten (Meta)</div>
        <div style={{ color: "#6b6358", fontSize: 13, marginBottom: 12 }}>
          Verbinde oder erneuere ein Meta-Werbekonto mit einem Access-Token. Der Token wird verschlüsselt in Supabase gespeichert
          (setze zuvor unter <b>Einstellungen</b> den <code>ADS_TOKEN_KEY</code>). Wichtig: Der Token muss aus einer
          <b> veröffentlichten</b> Meta-App stammen, sonst lassen sich Anzeigen anlegen, aber nicht schalten.
        </div>
        {adAccts.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid #efece6" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{a.label}</div>
              <div style={{ color: a.status === "connected" ? "#1f9d63" : a.status === "error" ? "#e0533d" : "#6b6358", fontSize: 12.5 }}>
                {a.metaAccountId} · {a.status === "connected" ? "verbunden" : a.status === "error" ? "Token prüfen / erneuern" : "nicht verbunden"}
              </div>
            </div>
            <button onClick={() => { setAdForm({ label: a.label, metaAccountId: a.metaAccountId, token: "", pageId: "" }); setAdMsg(null); }} style={{ ...btn, background: "#efece6", color: "#2b2723", padding: "7px 12px", fontSize: 13 }}>
              Token erneuern
            </button>
          </div>
        ))}
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <input placeholder="Bezeichnung (z. B. Christoph Werbung)" value={adForm.label} onChange={(e) => setAdForm((f) => ({ ...f, label: e.target.value }))} style={inp} />
          <input placeholder="Konto-ID (act_…)" value={adForm.metaAccountId} onChange={(e) => setAdForm((f) => ({ ...f, metaAccountId: e.target.value }))} style={inp} />
          <input type="password" placeholder="Access-Token (wird verschlüsselt gespeichert)" value={adForm.token} onChange={(e) => setAdForm((f) => ({ ...f, token: e.target.value }))} style={inp} />
          <input placeholder="Seiten-ID (optional, für Lead-Formulare)" value={adForm.pageId} onChange={(e) => setAdForm((f) => ({ ...f, pageId: e.target.value }))} style={inp} />
        </div>
        <button onClick={connectAd} disabled={adBusy} style={{ ...btn, background: "#9a4fc4", color: "#fff", width: "100%", marginTop: 10, opacity: adBusy ? 0.6 : 1 }}>
          {adBusy ? "Teste & verbinde …" : "Testen & verbinden"}
        </button>
        {adMsg && <p style={{ color: "#6b6358", fontSize: 14, marginTop: 10 }}>{adMsg}</p>}
      </div>

      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Kunden & Zugänge</div>
        <div style={{ color: "#6b6358", fontSize: 13, marginBottom: 12 }}>
          Lege einem Kunden einen eigenen Login an und verbinde sein Werbekonto. Der Kunde sieht nach dem Einloggen
          <b> nur sein Werbekonto</b> (Kennzahlen, Anzeigen, Leads/CRM) und kann Entwürfe zur Freigabe an dich senden.
        </div>
        {customers.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid #efece6" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{c.email || "(kein Login)"}</div>
              <div style={{ color: "#6b6358", fontSize: 12.5 }}>{c.accountLabel} · {c.metaAccountId}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1f9d63", background: "#e3f5ec", padding: "3px 9px", borderRadius: 11 }}>Kunde</span>
          </div>
        ))}
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <input placeholder="Kunden-E-Mail (Login)" value={custForm.email} onChange={(e) => setCustForm((f) => ({ ...f, email: e.target.value }))} style={inp} />
          <input type="password" placeholder="Passwort (min. 6 Zeichen)" value={custForm.password} onChange={(e) => setCustForm((f) => ({ ...f, password: e.target.value }))} style={inp} />
          <input placeholder="Bezeichnung des Werbekontos (z. B. Tennova Werbung)" value={custForm.label} onChange={(e) => setCustForm((f) => ({ ...f, label: e.target.value }))} style={inp} />
          <input placeholder="Werbekonto-ID (act_…)" value={custForm.metaAccountId} onChange={(e) => setCustForm((f) => ({ ...f, metaAccountId: e.target.value }))} style={inp} />
          <input type="password" placeholder="Access-Token des Werbekontos" value={custForm.token} onChange={(e) => setCustForm((f) => ({ ...f, token: e.target.value }))} style={inp} />
          <input placeholder="Seiten-ID (optional)" value={custForm.pageId} onChange={(e) => setCustForm((f) => ({ ...f, pageId: e.target.value }))} style={inp} />
        </div>
        <button onClick={createCustomer} disabled={custBusy} style={{ ...btn, background: "#2f6df0", color: "#fff", width: "100%", marginTop: 10, opacity: custBusy ? 0.6 : 1 }}>
          {custBusy ? "Lege an & verbinde …" : "Kunden-Login anlegen + Konto verbinden"}
        </button>
        {custMsg && <p style={{ color: "#6b6358", fontSize: 14, marginTop: 10 }}>{custMsg}</p>}
      </div>
    </main>
  );
}
