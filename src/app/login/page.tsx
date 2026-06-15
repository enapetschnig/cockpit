"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("hallo@epowergmbh.at");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
      if (error) {
        setErr(error.message === "Invalid login credentials" ? "E-Mail oder Passwort falsch." : error.message);
        setBusy(false);
        return;
      }
      window.location.href = "/";
    } catch (e) {
      setErr("Login fehlgeschlagen: " + (e as Error).message);
      setBusy(false);
    }
  }

  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 10, border: "1px solid #ddd6cb", fontSize: 15, marginTop: 10 };

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#faf9f6", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#2b2723", padding: 18 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360, background: "#fff", border: "1px solid #ece8e0", borderRadius: 16, padding: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>ePower Cockpit</div>
        <div style={{ color: "#6b6358", fontSize: 14, marginBottom: 8 }}>Bitte anmelden</div>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail" style={inp} />
        <input type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Passwort" style={inp} />
        {err && <div style={{ color: "#c0392b", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <button type="submit" disabled={busy || !pw} style={{ width: "100%", marginTop: 14, padding: "11px 16px", borderRadius: 10, border: "none", background: "#2f6df0", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: busy || !pw ? 0.6 : 1 }}>
          {busy ? "Anmelden …" : "Anmelden"}
        </button>
      </form>
    </main>
  );
}
