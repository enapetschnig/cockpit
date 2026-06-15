"use client";

import { useEffect, useState } from "react";

type Acc = { account: "firma" | "privat"; email: string | null; connected: boolean; lastSyncAt: string | null };
type Status = { configured: boolean; accounts: Acc[]; error?: string };

const LABEL: Record<string, string> = { firma: "Firma", privat: "Privat" };

export default function ConnectPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

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
  }, []);

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

  const card: React.CSSProperties = { background: "#fff", border: "1px solid #ece8e0", borderRadius: 14, padding: 18, marginBottom: 14 };
  const btn: React.CSSProperties = { display: "inline-block", padding: "10px 16px", borderRadius: 10, border: "none", fontWeight: 700, cursor: "pointer", fontSize: 14 };

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "28px 18px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#2b2723" }}>
      <a href="/" style={{ color: "#6b6358", textDecoration: "none", fontSize: 14 }}>‹ Zum Cockpit</a>
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
          <b>Noch nicht konfiguriert.</b> Trage <code>GOOGLE_CLIENT_ID</code> und <code>GOOGLE_CLIENT_SECRET</code> in
          die <code>.env</code> ein (Google-Cloud-OAuth-Client). Schritt-für-Schritt: <code>docs/09-gmail-anbindung.md</code>.
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
    </main>
  );
}
