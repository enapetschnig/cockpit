"use client";

/**
 * Eigener Bereich „Wünsche": alle Änderungswünsche, Fehler und Fragen aus den
 * Handwerker-Apps in einer Arbeitsliste. Die Apps schicken sie selbst hierher.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WunschDTO } from "@/lib/types";

const ACCENT = "#2f6df0";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #ece8e0", borderRadius: 14, padding: 16, marginBottom: 12 };
const muted: React.CSSProperties = { color: "#6b6358", fontSize: 13 };
const chip = (aktiv: boolean): React.CSSProperties => ({
  padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
  border: "1px solid " + (aktiv ? ACCENT : "#e2ddd4"),
  background: aktiv ? ACCENT : "#fff", color: aktiv ? "#fff" : "#4a443c",
});

const ART = { wunsch: { label: "Wunsch", bg: "#eef2f8", fg: "#3a4a63" },
              fehler: { label: "Fehler", bg: "#fdecea", fg: "#b3261e" },
              frage:  { label: "Frage",  bg: "#fff3e0", fg: "#9a6300" } } as const;
const STATUS = { neu: { label: "neu", bg: "#e8f0fe", fg: "#1a56c4" },
                 gesehen: { label: "gesehen", bg: "#f1efea", fg: "#6b6358" },
                 umgesetzt: { label: "umgesetzt", bg: "#eaf6ee", fg: "#1f7a44" },
                 abgelehnt: { label: "abgelehnt", bg: "#f1efea", fg: "#8a8175" } } as const;

function Badge({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return <span style={{ background: bg, color: fg, padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>{text}</span>;
}

function wann(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + " Min";
  if (diff < 86400) return Math.floor(diff / 3600) + " Std";
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + " Tg";
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function WuenschePage() {
  const [items, setItems] = useState<WunschDTO[]>([]);
  const [neu, setNeu] = useState(0);
  const [laden, setLaden] = useState(true);
  const [fApp, setFApp] = useState<string>("");
  const [fArt, setFArt] = useState<string>("");
  const [nurOffen, setNurOffen] = useState(false);
  const [bildOffen, setBildOffen] = useState<string | null>(null);

  const laden_ = useCallback(async () => {
    const p = new URLSearchParams();
    if (fApp) p.set("app", fApp);
    if (fArt) p.set("art", fArt);
    if (nurOffen) p.set("status", "offen");
    const r = await fetch("/api/wuensche?" + p.toString());
    if (!r.ok) { setLaden(false); return; }
    const d = (await r.json()) as { items: WunschDTO[]; neu: number };
    setItems(d.items ?? []);
    setNeu(d.neu ?? 0);
    setLaden(false);
  }, [fApp, fArt, nurOffen]);

  useEffect(() => { setLaden(true); laden_(); }, [laden_]);
  // Wünsche kommen per Trigger herein – alle 60 s nachsehen.
  useEffect(() => { const t = setInterval(() => laden_(), 60_000); return () => clearInterval(t); }, [laden_]);

  // Filter aus der Kundenliste: /wuensche?app=groismaier
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("app");
    if (a) setFApp(a);
  }, []);

  const apps = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) m.set(i.appKey, i.appLabel);
    return [...m.entries()];
  }, [items]);

  async function gesehen(w: WunschDTO) {
    const neuerWert = !w.gesehenAm;
    setItems((xs) => xs.map((x) => (x.id === w.id ? { ...x, gesehenAm: neuerWert ? new Date().toISOString() : null } : x)));
    setNeu((n) => Math.max(0, n + (neuerWert ? -1 : 1)));
    const r = await fetch(`/api/wuensche/${w.id}/gesehen`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gesehen: neuerWert }),
    });
    if (!r.ok) laden_(); // Serverstand gewinnt, wenn es schiefging
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "18px 14px 60px" }}>
      <a href="/" style={{ ...muted, textDecoration: "none" }}>‹ Cockpit</a>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "8px 0 4px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Wünsche</h1>
        {neu > 0 && <Badge text={`${neu} neu`} bg="#e8f0fe" fg="#1a56c4" />}
      </div>
      <p style={{ ...muted, marginTop: 0, marginBottom: 14 }}>
        Änderungswünsche, Fehler und Fragen aus allen Handwerker-Apps. Die Apps melden selbstständig hierher.
      </p>

      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ ...muted, marginRight: 4 }}>App</span>
        <span style={chip(!fApp)} onClick={() => setFApp("")}>alle</span>
        {apps.map(([k, l]) => <span key={k} style={chip(fApp === k)} onClick={() => setFApp(k)}>{l}</span>)}
        <span style={{ ...muted, margin: "0 4px 0 12px" }}>Art</span>
        <span style={chip(!fArt)} onClick={() => setFArt("")}>alle</span>
        {(["wunsch", "fehler", "frage"] as const).map((a) =>
          <span key={a} style={chip(fArt === a)} onClick={() => setFArt(a)}>{ART[a].label}</span>)}
        <span style={{ ...chip(nurOffen), marginLeft: "auto" }} onClick={() => setNurOffen((v) => !v)}>
          {nurOffen ? "✓ " : ""}nur ungesehene
        </span>
      </div>

      {laden ? (
        <div style={{ ...card, ...muted }}>Lade …</div>
      ) : !items.length ? (
        <div style={{ ...card, ...muted }}>
          Noch keine Meldungen. Sobald eine App scharfgeschaltet ist, erscheinen die Wünsche hier automatisch.
        </div>
      ) : items.map((w) => {
        const art = ART[w.art as keyof typeof ART] ?? { label: w.art, bg: "#f1efea", fg: "#6b6358" };
        const st = STATUS[w.status as keyof typeof STATUS] ?? { label: w.status, bg: "#f1efea", fg: "#6b6358" };
        const offen = !w.gesehenAm;
        return (
          <div key={w.id} style={{ ...card, borderLeft: `3px solid ${offen ? ACCENT : "#ece8e0"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>{w.kunde || w.appLabel}</strong>
              {w.kunde && <span style={muted}>· {w.appLabel}</span>}
              <Badge text={art.label} bg={art.bg} fg={art.fg} />
              <Badge text={st.label} bg={st.bg} fg={st.fg} />
              <span style={{ ...muted, marginLeft: "auto" }}>{wann(w.erstelltAm)}</span>
            </div>

            <div style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{w.text}</div>

            {(w.melder || w.seite) && (
              <div style={{ ...muted, marginTop: 6 }}>
                {w.melder && <>von {w.melder}</>}{w.melder && w.seite && " · "}{w.seite && <>Seite: {w.seite}</>}
              </div>
            )}

            {w.antwort && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: "#f7f5f1", borderRadius: 10, fontSize: 14 }}>
                <div style={{ ...muted, fontWeight: 700, marginBottom: 2 }}>Antwort in der App</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{w.antwort}</div>
              </div>
            )}

            {w.hatBild && (
              <div style={{ marginTop: 10 }}>
                {bildOffen === w.id ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`/api/wuensche/${w.id}/datei?art=bild`} alt="Screenshot"
                    style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid #ece8e0" }} />
                ) : (
                  <button onClick={() => setBildOffen(w.id)}
                    style={{ ...chip(false), border: "1px solid #e2ddd4" }}>Screenshot ansehen</button>
                )}
              </div>
            )}

            {w.hatAudio && (
              <audio controls preload="none" src={`/api/wuensche/${w.id}/datei?art=audio`}
                style={{ marginTop: 10, width: "100%", maxWidth: 320 }} />
            )}

            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => gesehen(w)} style={{
                padding: "7px 14px", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer",
                border: offen ? "none" : "1px solid #e2ddd4",
                background: offen ? ACCENT : "#fff", color: offen ? "#fff" : "#6b6358",
              }}>
                {offen ? "Gesehen" : "✓ gesehen – rückgängig"}
              </button>
              <span style={muted}>Erledigt wird in der App selbst gepflegt.</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
