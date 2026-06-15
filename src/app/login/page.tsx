"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "nosecret") setErr("Server nicht konfiguriert: SESSION_SECRET fehlt.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (r.ok) {
        window.location.href = "/";
      } else {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || "Login fehlgeschlagen");
      }
    } catch (e) {
      setErr("Login fehlgeschlagen: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#faf9f6", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#2b2723", padding: 18 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360, background: "#fff", border: "1px solid #ece8e0", borderRadius: 16, padding: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>ePower Cockpit</div>
        <div style={{ color: "#6b6358", fontSize: 14, marginBottom: 18 }}>Bitte anmelden</div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Passwort"
          style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 10, border: "1px solid #ddd6cb", fontSize: 15 }}
        />
        {err && <div style={{ color: "#c0392b", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <button type="submit" disabled={busy || !pw} style={{ width: "100%", marginTop: 14, padding: "11px 16px", borderRadius: 10, border: "none", background: "#2f6df0", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: busy || !pw ? 0.6 : 1 }}>
          {busy ? "Anmelden …" : "Anmelden"}
        </button>
      </form>
    </main>
  );
}
