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
  }, []);

  const KEY_LABEL: Record<string, string> = {
    OPENAI_API_KEY: "OpenAI API-Key",
    OPENAI_MODEL: "OpenAI Modell (z. B. gpt-4o-mini)",
    GOOGLE_CLIENT_ID: "Google Client-ID",
    GOOGLE_CLIENT_SECRET: "Google Client-Secret",
    TELEGRAM_BOT_TOKEN: "Telegram Bot-Token",
    TELEGRAM_CHAT_ID: "Telegram Chat-ID",
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
    </main>
  );
}
