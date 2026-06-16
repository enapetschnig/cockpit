"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BelegDTO, BuchungDTO, ReconcileMonthDTO } from "@/lib/types";

const ACCENT = "#2f6df0";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #ece8e0", borderRadius: 14, padding: 16, marginBottom: 14 };
const btn: React.CSSProperties = { display: "inline-block", padding: "7px 12px", borderRadius: 9, border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 };
const muted: React.CSSProperties = { color: "#6b6358", fontSize: 13 };

const STATUS_LABEL: Record<string, string> = {
  collected: "gesammelt",
  needs_review: "prüfen",
  queued: "in Warteschlange",
  uploading: "lädt zu BMD …",
  uploaded: "bei BMD ✓",
  failed: "fehlgeschlagen",
  skipped: "ignoriert",
};
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  collected: { bg: "#eef2f8", fg: "#3a4a63" },
  needs_review: { bg: "#fff3e0", fg: "#9a6300" },
  queued: { bg: "#fff7e6", fg: "#9a6300" },
  uploading: { bg: "#fff7e6", fg: "#9a6300" },
  uploaded: { bg: "#eaf6ee", fg: "#1f7a44" },
  failed: { bg: "#fdecea", fg: "#b3261e" },
  skipped: { bg: "#f1efea", fg: "#8a8175" },
};

function money(amount: string | null, currency: string): string {
  if (amount == null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  try {
    return n.toLocaleString("de-AT", { style: "currency", currency: currency || "EUR" });
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}
function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function BuchhaltungPage() {
  const [belege, setBelege] = useState<BelegDTO[]>([]);
  const [months, setMonths] = useState<ReconcileMonthDTO[]>([]);
  const [sel, setSel] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kontoRef = useRef<HTMLInputElement>(null);
  const karteRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [b, r] = await Promise.all([
      fetch("/api/buchhaltung").then((x) => x.json()),
      fetch("/api/buchhaltung/reconcile").then((x) => x.json()),
    ]);
    setBelege(b.belege || []);
    const ms: ReconcileMonthDTO[] = r.months || [];
    setMonths(ms);
    setSel((cur) => cur || ms[0]?.periodMonth || "");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  async function act(path: string, body: unknown, note?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post(path, body);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d.error || "Fehlgeschlagen");
      else if (note) setMsg(note);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function collect() {
    setBusy(true);
    setMsg("Sammle neue Rechnungen aus dem Postfach …");
    try {
      const r = await fetch("/api/gmail/sync", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setMsg(r.ok ? `Sync fertig: ${d.imported ?? 0} neue Mail(s) geprüft.` : d.error || "Sync fehlgeschlagen");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function uploadStatement(file: File, kind: "kontoauszug" | "kreditkarte") {
    setBusy(true);
    setMsg(`Lade ${kind === "kreditkarte" ? "Kreditkarte" : "Kontoauszug"} hoch …`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const r = await fetch("/api/buchhaltung/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d.error === "schon hochgeladen" ? "Diese Datei wurde schon hochgeladen." : d.error || "Upload fehlgeschlagen");
      else setMsg(`${d.parsed} Buchungen erkannt · ${d.autoMatched} automatisch zugeordnet.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  const rechnungen = useMemo(() => belege.filter((b) => b.kind === "rechnung"), [belege]);
  const ausz = useMemo(() => belege.filter((b) => b.kind !== "rechnung"), [belege]);
  const counts = useMemo(() => {
    const open = belege.filter((b) => ["collected", "needs_review"].includes(b.status)).length;
    const failed = belege.filter((b) => b.status === "failed").length;
    const done = belege.filter((b) => b.status === "uploaded").length;
    const queued = belege.filter((b) => ["queued", "uploading"].includes(b.status)).length;
    return { open, failed, done, queued };
  }, [belege]);

  const byMonth = useMemo(() => {
    const m = new Map<string, BelegDTO[]>();
    for (const b of rechnungen) {
      const k = b.periodMonth || "—";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rechnungen]);

  const selMonth = months.find((m) => m.periodMonth === sel);

  function Pill({ status }: { status: string }) {
    const c = STATUS_COLOR[status] || STATUS_COLOR.collected;
    return <span style={{ background: c.bg, color: c.fg, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 700 }}>{STATUS_LABEL[status] || status}</span>;
  }

  function BelegRow({ b }: { b: BelegDTO }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid #f3f0ea" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {b.vendor} <span style={{ ...muted, fontWeight: 400 }}>· {money(b.amount, b.currency)}</span>
          </div>
          <div style={{ ...muted, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {b.fileName || ""} {b.invoiceNumber ? `· ${b.invoiceNumber}` : ""} {b.bmdError ? `· ⚠️ ${b.bmdError}` : ""}
          </div>
        </div>
        <Pill status={b.status} />
        <div style={{ display: "flex", gap: 6 }}>
          {(b.status === "collected" || b.status === "skipped" || b.status === "needs_review") && (
            <button disabled={busy} onClick={() => act("/api/buchhaltung/send-to-bmd", { belegId: b.id })} style={{ ...btn, background: ACCENT, color: "#fff" }}>An BMD</button>
          )}
          {b.status === "failed" && (
            <button disabled={busy} onClick={() => act("/api/buchhaltung/retry", { belegId: b.id })} style={{ ...btn, background: "#b3261e", color: "#fff" }}>↻ Erneut</button>
          )}
          <a href={`/api/buchhaltung/file/${b.id}`} target="_blank" rel="noreferrer" style={{ ...btn, background: "#efece6", color: "#2b2723", textDecoration: "none" }}>PDF</a>
          {!["uploaded", "skipped", "uploading", "queued"].includes(b.status) && (
            <button disabled={busy} onClick={() => act("/api/buchhaltung/skip", { belegId: b.id })} style={{ ...btn, background: "#f1efea", color: "#8a8175" }}>🚫</button>
          )}
        </div>
      </div>
    );
  }

  function BuchungLine({ bk, right }: { bk: BuchungDTO; right?: React.ReactNode }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid #f3f0ea" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <b>{shortDate(bk.bookingDate)}</b> · <span style={{ color: Number(bk.amount) < 0 ? "#b3261e" : "#1f7a44" }}>{money(bk.amount, bk.currency)}</span> · {bk.counterparty || "—"}
          </div>
          {bk.purpose && <div style={{ ...muted, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bk.purpose}</div>}
        </div>
        {right}
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#2b2723" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <a href="/" style={{ color: "#6b6358", textDecoration: "none", fontSize: 14 }}>‹ Zum Cockpit</a>
        <a href="/connect" style={{ color: "#6b6358", textDecoration: "none", fontSize: 13 }}>Einstellungen ›</a>
      </div>
      <h1 style={{ fontSize: 24, margin: "12px 0 2px" }}>Buchhaltung</h1>
      <p style={{ ...muted, marginTop: 0 }}>
        Rechnungen werden automatisch aus dem Postfach gesammelt. Per Klick gehen sie ans BMD-Portal. Kontoauszug &amp; Kreditkarte hochladen → automatischer Abgleich.
      </p>

      <div style={{ ...muted, marginBottom: 10 }}>
        {counts.open} offen · {counts.queued} in Arbeit · {counts.failed} fehlgeschlagen · {counts.done} bei BMD
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button disabled={busy} onClick={collect} style={{ ...btn, background: "#1f9d63", color: "#fff" }}>↻ Jetzt sammeln</button>
        <button disabled={busy || counts.open === 0} onClick={() => act("/api/buchhaltung/send-to-bmd", { all: true }, "Alle offenen Belege freigegeben.")} style={{ ...btn, background: ACCENT, color: "#fff", opacity: counts.open === 0 ? 0.5 : 1 }}>📤 Alle an BMD senden</button>
      </div>
      {msg && <div style={{ ...card, background: "#f8f6f1", padding: "10px 14px" }}>{msg}</div>}

      {/* Rechnungen nach Monat */}
      {byMonth.length === 0 && <div style={{ ...card, ...muted }}>Noch keine Rechnungen gesammelt. „Jetzt sammeln" holt sie aus dem Postfach (Storage muss in den Einstellungen konfiguriert sein).</div>}
      {byMonth.map(([month, list]) => (
        <div key={month} style={card}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{month === "—" ? "Ohne Datum" : month}</div>
          {list.map((b) => <BelegRow key={b.id} b={b} />)}
        </div>
      ))}

      {/* Abgleich */}
      <h2 style={{ fontSize: 19, margin: "22px 0 6px" }}>Abgleich</h2>
      <div style={card}>
        <div style={{ ...muted, marginBottom: 10 }}>Monats-Auszug hochladen (George-CSV bevorzugt, PDF wird archiviert). Buchungen werden automatisch den Rechnungen zugeordnet.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={busy} onClick={() => kontoRef.current?.click()} style={{ ...btn, background: "#5a6675", color: "#fff" }}>＋ Kontoauszug</button>
          <button disabled={busy} onClick={() => karteRef.current?.click()} style={{ ...btn, background: "#5a6675", color: "#fff" }}>＋ Kreditkarte</button>
          <input ref={kontoRef} type="file" accept=".csv,.pdf" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && uploadStatement(e.target.files[0], "kontoauszug")} />
          <input ref={karteRef} type="file" accept=".csv,.pdf" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && uploadStatement(e.target.files[0], "kreditkarte")} />
        </div>
        {ausz.length > 0 && (
          <div style={{ ...muted, fontSize: 12, marginTop: 8 }}>
            Hochgeladen: {ausz.map((a) => `${a.vendor} (${a.periodMonth}, ${STATUS_LABEL[a.status] || a.status})`).join(" · ")}
          </div>
        )}
      </div>

      {months.length > 0 && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ ...muted }}>Monat:</span>
            <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd6cb", fontSize: 14 }}>
              {months.map((m) => <option key={m.periodMonth} value={m.periodMonth}>{m.periodMonth}</option>)}
            </select>
          </div>

          {selMonth && (
            <>
              {/* ⚠️ Buchung ohne Beleg */}
              <Section title={`⚠️ Buchung ohne Beleg (${selMonth.bookingsWithoutInvoice.length})`} color="#9a6300">
                {selMonth.bookingsWithoutInvoice.length === 0 && <div style={muted}>Alles zugeordnet 🎉</div>}
                {selMonth.bookingsWithoutInvoice.map((bk) => (
                  <BuchungLine
                    key={bk.id}
                    bk={bk}
                    right={
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <select
                          defaultValue=""
                          disabled={busy}
                          onChange={(e) => e.target.value && act("/api/buchhaltung/match", { buchungId: bk.id, belegId: e.target.value })}
                          style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid #ddd6cb", fontSize: 12, maxWidth: 150 }}
                        >
                          <option value="">zuordnen …</option>
                          {selMonth.invoicesWithoutBooking.map((inv) => (
                            <option key={inv.id} value={inv.id}>{inv.vendor} · {money(inv.amount, inv.currency)}</option>
                          ))}
                        </select>
                        <button disabled={busy} onClick={() => act("/api/buchhaltung/match", { buchungId: bk.id, ignore: true })} style={{ ...btn, background: "#f1efea", color: "#8a8175" }}>🚫</button>
                      </div>
                    }
                  />
                ))}
              </Section>

              {/* 📄 Rechnung ohne Buchung */}
              <Section title={`📄 Rechnung ohne Buchung (${selMonth.invoicesWithoutBooking.length})`} color="#3a4a63">
                {selMonth.invoicesWithoutBooking.length === 0 && <div style={muted}>Keine offenen Rechnungen.</div>}
                {selMonth.invoicesWithoutBooking.map((inv) => (
                  <div key={inv.id} style={{ fontSize: 13.5, padding: "6px 0", borderTop: "1px solid #f3f0ea" }}>
                    <b>{inv.vendor}</b> · {money(inv.amount, inv.currency)} <span style={muted}>· {inv.fileName || ""}</span>
                  </div>
                ))}
              </Section>

              {/* ✅ Zugeordnet */}
              <Section title={`✅ Zugeordnet (${selMonth.matched.length})`} color="#1f7a44">
                {selMonth.matched.length === 0 && <div style={muted}>Noch nichts zugeordnet.</div>}
                {selMonth.matched.map(({ buchung, beleg }) => (
                  <BuchungLine
                    key={buchung.id}
                    bk={buchung}
                    right={
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ ...muted, fontSize: 12 }}>→ {beleg.vendor}</span>
                        <button disabled={busy} onClick={() => act("/api/buchhaltung/match", { buchungId: buchung.id, belegId: null })} style={{ ...btn, background: "#f1efea", color: "#8a8175" }}>lösen</button>
                      </div>
                    }
                  />
                ))}
              </Section>
            </>
          )}
        </div>
      )}
    </main>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color, marginBottom: 2 }}>{title}</div>
      {children}
    </div>
  );
}
