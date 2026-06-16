"use client";

import { useEffect, useRef, useState } from "react";
import { LABELS } from "@/lib/labels";
import type { EmailDTO, CustomerDTO } from "@/lib/types";

type Tab = "firmenrelevant" | "wichtig" | "buchhaltung" | "zuordnen" | "alle";
type Acc = "alle" | "firma" | "privat";
type View = "inbox" | "email" | "kunden" | "kunde" | "gesendet" | "kalender";
type CalEv = { id: string; summary: string; start: string; end: string; location?: string; allDay: boolean; account: string };

const PALETTE = ["#2f6df0", "#1f9d63", "#d8932a", "#e0533d", "#9a4fc4", "#1c8a90", "#5a6675"];

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function colorFor(e: EmailDTO) {
  if (e.customer?.color) return e.customer.color;
  let h = 0;
  for (const ch of e.fromName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const json = { "Content-Type": "application/json" };

export default function Cockpit() {
  const [emails, setEmails] = useState<EmailDTO[]>([]);
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [acc, setAcc] = useState<Acc>("alle");
  const [tab, setTab] = useState<Tab>("firmenrelevant");
  const [view, setView] = useState<View>("inbox");
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Record<string, string[]>>({});
  const [classifying, setClassifying] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Antwort (Web)
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyInstr, setReplyInstr] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  // Kalender (Web)
  const [events, setEvents] = useState<CalEv[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  async function loadEmails() {
    const r = await fetch("/api/emails");
    setEmails(await r.json());
  }
  async function loadCustomers() {
    const r = await fetch("/api/customers");
    setCustomers(await r.json());
  }
  useEffect(() => {
    Promise.all([loadEmails(), loadCustomers()]).finally(() => setLoading(false));
  }, []);

  // Inbox alle 60s aktualisieren – zeigt neue Mails vom Auto-Sync automatisch an.
  useEffect(() => {
    const t = setInterval(() => loadEmails(), 60_000);
    return () => clearInterval(t);
  }, []);

  // Beim Öffnen einmal synchronisieren – so ist alles aktuell, sobald man reingeht.
  useEffect(() => {
    fetch("/api/gmail/sync", { method: "POST" })
      .then(() => Promise.all([loadEmails(), loadCustomers()]))
      .catch(() => {});
  }, []);

  // Kalender laden, sobald die Kalender-Ansicht geöffnet wird.
  useEffect(() => {
    if (view !== "kalender") return;
    setEventsLoading(true);
    fetch("/api/calendar?days=14")
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, [view]);

  // Demo-Push beim ersten Laden: zeigt eine firmenrelevante Mail aus dem Privat-Postfach
  useEffect(() => {
    if (loading) return;
    const cross = emails.find((e) => e.account === "privat" && e.firmenrelevant);
    if (cross) {
      const t = setTimeout(
        () => pushToast("Firmenrelevant — im Privat-Postfach", `${cross.fromName}: ${cross.subject}`),
        1200
      );
      return () => clearTimeout(t);
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  function pushToast(title: string, body: string) {
    setToast({ title, body });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4600);
  }

  const inAcc = (e: EmailDTO) => acc === "alle" || e.account === acc;
  const visible = emails.filter(inAcc).filter((e) => !e.outgoing); // Gesendetes nicht im Posteingang

  const counts = {
    firmenrelevant: visible.filter((e) => e.firmenrelevant).length,
    wichtig: visible.filter((e) => e.priority === "hi").length,
    buchhaltung: visible.filter((e) => !e.filed && e.labels.includes("buchhaltung")).length,
    zuordnen: visible.filter((e) => e.firmenrelevant && !e.customerId && !e.filed).length,
    alle: visible.length,
  };
  const TABS: { id: Tab; label: string }[] = [
    { id: "firmenrelevant", label: "Firmenrelevant" },
    { id: "wichtig", label: "Wichtig" },
    { id: "buchhaltung", label: "Buchhaltung" },
    { id: "zuordnen", label: "Zuordnen" },
    { id: "alle", label: "Alle" },
  ];

  function filtered() {
    let l = visible;
    if (tab === "firmenrelevant") l = l.filter((e) => e.firmenrelevant);
    else if (tab === "wichtig") l = l.filter((e) => e.priority === "hi");
    else if (tab === "buchhaltung") l = l.filter((e) => e.labels.includes("buchhaltung"));
    else if (tab === "zuordnen") l = l.filter((e) => e.firmenrelevant && !e.customerId && !e.filed);
    return l;
  }

  const activeEmail = emails.find((e) => e.id === activeEmailId) || null;
  const activeCustomer = customers.find((c) => c.id === activeCustomerId) || null;

  // ── Aktionen ──────────────────────────────────────────────
  function openEmail(id: string) {
    setActiveEmailId(id);
    setView("email");
    setReplyFor(null);
    setReplyText("");
    setReplyInstr("");
  }
  async function draftReply(emailId: string) {
    setReplyBusy(true);
    setReplyFor(emailId);
    try {
      const r = await fetch("/api/reply", { method: "POST", headers: json, body: JSON.stringify({ emailId, instruction: replyInstr }) });
      const d = await r.json();
      if (r.ok) setReplyText(d.text || "");
      else pushToast("Fehler", d.error || "Entwurf fehlgeschlagen");
    } catch {
      pushToast("Fehler", "Entwurf fehlgeschlagen");
    } finally {
      setReplyBusy(false);
    }
  }
  async function sendReplyWeb(emailId: string, toName: string) {
    if (!replyText.trim()) return;
    setReplyBusy(true);
    try {
      const r = await fetch("/api/reply/send", { method: "POST", headers: json, body: JSON.stringify({ emailId, text: replyText }) });
      const d = await r.json();
      if (r.ok) {
        pushToast("Gesendet", `Antwort an ${toName} gesendet.`);
        setReplyFor(null);
        setReplyText("");
        setReplyInstr("");
      } else pushToast("Fehler", d.error || "Senden fehlgeschlagen");
    } catch {
      pushToast("Fehler", "Senden fehlgeschlagen");
    } finally {
      setReplyBusy(false);
    }
  }
  async function classifyNow(id: string) {
    setClassifying(true);
    try {
      const r = await fetch("/api/classify", { method: "POST", headers: json, body: JSON.stringify({ emailId: id }) });
      const data = await r.json();
      if (data?.email) setEmails((prev) => prev.map((e) => (e.id === id ? data.email : e)));
      if (Array.isArray(data?.suggestedTodos)) setSuggested((s) => ({ ...s, [id]: data.suggestedTodos }));
    } finally {
      setClassifying(false);
    }
  }
  async function assign(emailId: string, body: Record<string, unknown>) {
    const r = await fetch("/api/assign", { method: "POST", headers: json, body: JSON.stringify({ emailId, ...body }) });
    const updated = await r.json();
    if (updated?.id) setEmails((prev) => prev.map((e) => (e.id === emailId ? updated : e)));
    await loadCustomers();
  }
  function assignCustomer(e: EmailDTO, customerId: string) {
    assign(e.id, { customerId, todos: suggested[e.id] ?? defaultTodos(e) });
  }
  function assignNew(e: EmailDTO) {
    const name = window.prompt("Name des neuen Kunden?");
    if (name && name.trim()) assign(e.id, { newCustomerName: name.trim(), todos: suggested[e.id] ?? defaultTodos(e) });
  }
  function fileBuch(e: EmailDTO) {
    assign(e.id, { fileBuch: true });
  }
  function defaultTodos(e: EmailDTO): string[] {
    const out: string[] = [];
    if (e.labels.includes("angebot")) out.push("Angebot vorbereiten");
    if (e.labels.includes("support")) out.push("Problem prüfen & zurückmelden");
    if (e.labels.includes("termin")) out.push("Termin fixieren");
    return out;
  }
  async function makeTask(e: EmailDTO) {
    const tasks = suggested[e.id] ?? defaultTodos(e);
    if (!e.customerId) {
      pushToast("Noch kein Kunde", "Ordne die Mail zuerst einem Kunden zu, dann lege ich die Aufgabe dort ab.");
      return;
    }
    if (tasks.length === 0) tasks.push("Follow-up zu: " + e.subject);
    for (const t of tasks) {
      await fetch("/api/todos", { method: "POST", headers: json, body: JSON.stringify({ text: t, customerId: e.customerId, emailId: e.id }) });
    }
    await loadCustomers();
    pushToast("Aufgabe erstellt", `${tasks.length} Aufgabe(n) bei ${e.customer?.name ?? "Kunde"} angelegt.`);
  }
  async function toggleTodo(customerId: string, todoId: string, done: boolean) {
    await fetch("/api/todos", { method: "PATCH", headers: json, body: JSON.stringify({ id: todoId, done }) });
    setCustomers((prev) =>
      prev.map((c) =>
        c.id !== customerId
          ? c
          : { ...c, todos: c.todos.map((t) => (t.id === todoId ? { ...t, done } : t)), openTodos: c.todos.filter((t) => (t.id === todoId ? !done : !t.done)).length }
      )
    );
  }
  async function createCustomer() {
    const name = newCustName.trim();
    if (!name) return;
    await fetch("/api/customers", { method: "POST", headers: json, body: JSON.stringify({ name }) });
    setNewCustName("");
    await loadCustomers();
  }
  async function testPush() {
    const r = await fetch("/api/notify", { method: "POST", headers: json, body: JSON.stringify({ text: "🔔 Test vom ePower Cockpit" }) });
    const res = await r.json();
    pushToast("Push gesendet", res?.skipped ? "Telegram noch nicht konfiguriert – nur im Server-Log." : "An Telegram übermittelt.");
  }

  // ── Render-Helfer ─────────────────────────────────────────
  function LabelPills({ e }: { e: EmailDTO }) {
    return (
      <>
        {e.account === "privat" && e.firmenrelevant ? (
          <>
            <span className="lab l-cross">↳ Firmenrelevant</span>
            <span className="pill p-acct privat">Privat-Konto</span>
          </>
        ) : (
          <span className={"pill p-acct" + (e.account === "privat" ? " privat" : "")}>{e.account === "firma" ? "Firma" : "Privat"}</span>
        )}
        {e.labels.map((k) => (LABELS[k] ? <span key={k} className={"lab " + LABELS[k].c}>{LABELS[k].t}</span> : null))}
        {e.customer ? (
          <span className="pill p-cust">● {e.customer.name}</span>
        ) : e.filed ? (
          <span className="lab l-buch">in Buchhaltung ✓</span>
        ) : e.firmenrelevant ? (
          <span className="pill p-none">offen</span>
        ) : null}
      </>
    );
  }

  function MailCard({ e }: { e: EmailDTO }) {
    return (
      <div className="mail" onClick={() => openEmail(e.id)}>
        <div className="mtop">
          <div className="av" style={{ background: colorFor(e) }}>{initials(e.fromName)}</div>
          <div className="mfrom">{e.fromName}</div>
          <div className="mtime">{timeAgo(e.receivedAt)}</div>
        </div>
        <div className="msub">{e.subject}</div>
        {e.summary && (
          <div className="ai"><span className="aibadge">KI</span><span className="aitxt">{e.summary}</span></div>
        )}
        <div className="mtags"><span className={"reldot r" + e.priority} /><LabelPills e={e} /></div>
      </div>
    );
  }

  function AssignCard({ e }: { e: EmailDTO }) {
    return (
      <div className="assignbar">
        <div className="mtop">
          <div className="av" style={{ background: colorFor(e) }}>{initials(e.fromName)}</div>
          <div className="mfrom">{e.fromName}</div>
          <div className="mtime">{timeAgo(e.receivedAt)}</div>
        </div>
        <div className="msub">{e.subject}</div>
        {e.summary && <div className="ai"><span className="aibadge">KI</span><span className="aitxt">{e.summary}</span></div>}
        <div className="q">KI-Vorschlag — wohin zuordnen?</div>
        <div className="sug">
          {e.labels.includes("buchhaltung") && (
            <button className="sugbtn buch" onClick={() => fileBuch(e)}>→ Buchhaltung / BMD</button>
          )}
          {customers.slice(0, 2).map((c) => (
            <button key={c.id} className="sugbtn" onClick={() => assignCustomer(e, c.id)}>+ {c.name}</button>
          ))}
          <button className="sugbtn alt" onClick={() => assignNew(e)}>+ Neuer Kunde</button>
        </div>
      </div>
    );
  }

  // ── UI ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="app">
        <div className="loading">Lade Cockpit …</div>
      </div>
    );
  }

  const list = filtered();

  return (
    <div className="app">
      {toast && (
        <div className="toast show" onClick={() => { setToast(null); const c = emails.find((e) => e.account === "privat" && e.firmenrelevant); if (c) openEmail(c.id); }}>
          <div className="tg">📨 Telegram · ePower-Bot</div>
          <div className="th">{toast.title}</div>
          <div className="tb">{toast.body}</div>
        </div>
      )}

      <div className="header">
        <div className="hrow">
          <div>
            <div className="htitle">Posteingang</div>
            <div className="hsub"><span className="dot" /> 2 Konten · KI aktiv · <a href="/connect" style={{ color: "inherit", textDecoration: "underline" }}>Gmail verbinden</a></div>
          </div>
          <button className="bell" onClick={testPush} aria-label="Push testen">
            <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
            {counts.wichtig > 0 && <span className="badge">{counts.wichtig}</span>}
          </button>
        </div>
        <div className="accts">
          {(["alle", "firma", "privat"] as Acc[]).map((a) => (
            <button key={a} className={"acc " + a + (acc === a ? " active" : "")} onClick={() => setAcc(a)}>
              {a !== "alle" && <span className="pin" />}
              {a === "alle" ? "Beide Konten" : a === "firma" ? "Firma" : "Privat"}
            </button>
          ))}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
            {t.label}<span className="n">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="scroll">
        {tab === "zuordnen" ? (
          <>
            <div className="secttl">KI hat erkannt — von dir bestätigen</div>
            {list.length ? list.map((e) => <AssignCard key={e.id} e={e} />) : <div className="muted">Alles zugeordnet ✓</div>}
          </>
        ) : list.length ? (
          list.map((e) => <MailCard key={e.id} e={e} />)
        ) : (
          <div className="muted">Keine Mails in diesem Filter.</div>
        )}
      </div>

      {/* E-Mail-Detail */}
      <div className={"view" + (view === "email" ? " open" : "")}>
        <div className="vhead"><button className="back" onClick={() => setView("inbox")}>‹ Posteingang</button></div>
        <div className="vbody">
          {activeEmail && (
            <>
              <div className="card">
                {activeEmail.account === "privat" && activeEmail.firmenrelevant && (
                  <div style={{ marginBottom: 8 }}><span className="lab l-cross">↳ firmenrelevant — kam im Privat-Postfach an</span></div>
                )}
                <div className="mtop">
                  <div className="av" style={{ background: colorFor(activeEmail) }}>{initials(activeEmail.fromName)}</div>
                  <div><div className="mfrom" style={{ fontSize: 15 }}>{activeEmail.fromName}</div><div className="kv">{activeEmail.fromAddr}</div></div>
                </div>
                <div className="msub" style={{ fontSize: 16, marginTop: 12 }}>{activeEmail.subject}</div>
                <div className="mailbody">{activeEmail.body}</div>
              </div>

              <div className="card aicard">
                <div className="ai" style={{ background: "transparent", padding: 0, margin: 0 }}>
                  <span className="aibadge">KI</span>
                  <span className="aitxt"><b>Zusammenfassung:</b> {activeEmail.summary || "— noch nicht klassifiziert —"}</span>
                </div>
                <div className="mtags" style={{ marginTop: 10 }}>
                  {activeEmail.labels.map((k) => (LABELS[k] ? <span key={k} className={"lab " + LABELS[k].c}>{LABELS[k].t}</span> : null))}
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn ai" disabled={classifying} onClick={() => classifyNow(activeEmail.id)}>
                    {classifying ? "Klassifiziere …" : "Mit KI neu klassifizieren"}
                  </button>
                </div>
                <div className="kv" style={{ marginTop: 9, fontSize: 11 }}>analysiert mit OpenAI</div>
              </div>

              <div className="card">
                {activeEmail.customer ? (
                  <>
                    <div className="kv">Kunde</div>
                    <div style={{ fontWeight: 700 }}>{activeEmail.customer.name}{activeEmail.customer.meta ? <span style={{ color: "var(--sub)", fontWeight: 500 }}> · {activeEmail.customer.meta}</span> : null}</div>
                  </>
                ) : (
                  <>
                    <div className="kv">Zuordnen</div>
                    <div className="sug" style={{ marginTop: 5 }}>
                      {activeEmail.labels.includes("buchhaltung") && <button className="sugbtn buch" onClick={() => fileBuch(activeEmail)}>→ Buchhaltung / BMD</button>}
                      {customers.slice(0, 2).map((c) => <button key={c.id} className="sugbtn" onClick={() => assignCustomer(activeEmail, c.id)}>+ {c.name}</button>)}
                      <button className="sugbtn alt" onClick={() => assignNew(activeEmail)}>+ Neuer Kunde</button>
                    </div>
                  </>
                )}
              </div>

              <div className="actions">
                {activeEmail.labels.includes("aufgabe") && <button className="btn ai" onClick={() => makeTask(activeEmail)}>+ Aufgabe erstellen</button>}
                <button className="btn primary" disabled={replyBusy && replyFor === activeEmail.id} onClick={() => draftReply(activeEmail.id)}>
                  {replyBusy && replyFor === activeEmail.id && !replyText ? "Entwerfe …" : "KI-Antwort entwerfen"}
                </button>
                <button className="btn ghost" onClick={() => setView("inbox")}>Erledigt</button>
              </div>

              {replyFor === activeEmail.id && (replyText || replyBusy) && (
                <div className="card">
                  <div className="kv" style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>Antwort-Entwurf an {activeEmail.fromName}</div>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={8}
                    placeholder={replyBusy ? "Entwerfe …" : ""}
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical" }}
                  />
                  <div className="addrow" style={{ marginTop: 8 }}>
                    <input placeholder="Anweisung (z. B. kürzer, förmlicher) → neu entwerfen" value={replyInstr} onChange={(e) => setReplyInstr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && draftReply(activeEmail.id)} />
                    <button className="btn ghost" style={{ flex: "none", minWidth: 0, padding: "10px 14px" }} disabled={replyBusy} onClick={() => draftReply(activeEmail.id)}>↻</button>
                  </div>
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button className="btn primary" disabled={replyBusy || !replyText.trim()} onClick={() => sendReplyWeb(activeEmail.id, activeEmail.fromName)}>✅ Senden</button>
                    <button className="btn ghost" onClick={() => { setReplyFor(null); setReplyText(""); }}>Verwerfen</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Kundenliste */}
      <div className={"view" + (view === "kunden" ? " open" : "")}>
        <div className="vhead"><button className="back" onClick={() => setView("inbox")}>‹ Cockpit</button><strong style={{ fontSize: 16 }}>Kunden</strong></div>
        <div className="vbody">
          {customers.map((c) => (
            <div key={c.id} className="kcard" onClick={() => { setActiveCustomerId(c.id); setView("kunde"); }}>
              <div className="av" style={{ background: c.color || "#2f6df0" }}>{initials(c.name)}</div>
              <div><div className="kname">{c.name}</div><div className="kmeta">{c.meta || "—"}</div></div>
              {c.openTodos > 0 && <div className="kbadge">{c.openTodos} offen</div>}
            </div>
          ))}
          <div className="addrow">
            <input placeholder="Neuen Kunden anlegen …" value={newCustName} onChange={(e) => setNewCustName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createCustomer()} />
            <button className="btn primary" style={{ flex: "none", minWidth: 0, padding: "10px 16px" }} onClick={createCustomer}>+</button>
          </div>
        </div>
      </div>

      {/* Kunden-Detail */}
      <div className={"view" + (view === "kunde" ? " open" : "")}>
        <div className="vhead"><button className="back" onClick={() => setView("kunden")}>‹ Kunden</button></div>
        <div className="vbody">
          {activeCustomer && (
            <>
              <div className="card">
                <div className="mtop">
                  <div className="av" style={{ background: activeCustomer.color || "#2f6df0", width: 44, height: 44 }}>{initials(activeCustomer.name)}</div>
                  <div><div className="kname" style={{ fontSize: 17 }}>{activeCustomer.name}</div><div className="kmeta">{activeCustomer.meta || "—"}</div></div>
                </div>
              </div>
              <div className="card">
                <div className="kv" style={{ marginBottom: 4, fontWeight: 700, color: "var(--ink)" }}>Was noch zu tun ist</div>
                {activeCustomer.todos.length ? activeCustomer.todos.map((t) => (
                  <div key={t.id} className={"todo" + (t.done ? " done" : "")} onClick={() => toggleTodo(activeCustomer.id, t.id, !t.done)}>
                    <div className="chk"><svg viewBox="0 0 24 24" strokeWidth={3}><path d="M5 12l5 5L20 6" /></svg></div>
                    <div className="ttxt">{t.text}</div>
                  </div>
                )) : <div className="muted">Keine offenen Aufgaben.</div>}
              </div>
              <div className="card">
                <div className="kv" style={{ marginBottom: 8, fontWeight: 700, color: "var(--ink)" }}>Zugeordnete E-Mails</div>
                <div className="tl">
                  {emails.filter((e) => e.customerId === activeCustomer.id).map((e) => (
                    <div key={e.id} className="ti"><div className="tlt">{e.subject}</div><div className="tld">{timeAgo(e.receivedAt)} · {e.fromAddr}</div></div>
                  ))}
                  {emails.filter((e) => e.customerId === activeCustomer.id).length === 0 && <div className="tld">Noch keine Mails zugeordnet</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Gesendet */}
      <div className={"view" + (view === "gesendet" ? " open" : "")}>
        <div className="vhead"><button className="back" onClick={() => setView("inbox")}>‹ Cockpit</button><strong style={{ fontSize: 16 }}>Gesendet</strong></div>
        <div className="vbody">
          {(() => {
            const sent = emails.filter((e) => e.outgoing && inAcc(e));
            return sent.length ? sent.map((e) => <MailCard key={e.id} e={e} />) : <div className="muted">Keine gesendeten Mails.</div>;
          })()}
        </div>
      </div>

      {/* Kalender */}
      <div className={"view" + (view === "kalender" ? " open" : "")}>
        <div className="vhead"><button className="back" onClick={() => setView("inbox")}>‹ Cockpit</button><strong style={{ fontSize: 16 }}>Kalender</strong></div>
        <div className="vbody">
          {eventsLoading ? (
            <div className="muted">Lade Termine …</div>
          ) : events.length === 0 ? (
            <div className="muted">Keine Termine in den nächsten 14 Tagen.</div>
          ) : (
            groupByDay(events).map(([day, evs]) => (
              <div key={day} className="cal-day">
                <div className="cal-daylabel">{dayLabel(day)}</div>
                {evs.map((ev) => (
                  <div key={ev.account + ev.id} className="cal-ev">
                    <div className="cal-time">{ev.allDay ? "ganztägig" : evTime(ev.start)}</div>
                    <div className="cal-main">
                      <div className="cal-title">{ev.summary || "(ohne Titel)"}</div>
                      {ev.location && <div className="cal-loc">{ev.location}</div>}
                    </div>
                    <span className={"pill " + (ev.account === "privat" ? "pill-privat" : "pill-firma")}>{ev.account}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {view === "inbox" && <div className="vphold">Wähle links eine Mail, um sie hier zu öffnen.</div>}

      {/* Bottom-Nav */}
      <div className="nav">
        <button className={"navi" + (view === "inbox" ? " active" : "")} onClick={() => setView("inbox")}>
          <svg viewBox="0 0 24 24"><path d="M3 7l9 6 9-6" /><rect x="3" y="5" width="18" height="14" rx="2" /></svg>Posteingang
        </button>
        <button className={"navi" + (view === "kunden" || view === "kunde" ? " active" : "")} onClick={() => setView("kunden")}>
          <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6.2a3 3 0 0 1 0 5.6" /><path d="M20.5 19a5 5 0 0 0-3.5-4.8" /></svg>Kunden
        </button>
        <button className={"navi" + (view === "gesendet" ? " active" : "")} onClick={() => setView("gesendet")}>
          <svg viewBox="0 0 24 24"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>Gesendet
        </button>
        <button className={"navi" + (view === "kalender" ? " active" : "")} onClick={() => setView("kalender")}>
          <svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>Kalender
        </button>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + " Min";
  if (diff < 86400) return Math.floor(diff / 3600) + " Std";
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + " Tg";
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
}

// Termine nach Kalendertag (YYYY-MM-DD) gruppieren, chronologisch.
function groupByDay(events: CalEv[]): [string, CalEv[]][] {
  const map = new Map<string, CalEv[]>();
  for (const ev of events) {
    const day = ev.start.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(ev);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function dayLabel(day: string): string {
  const d = new Date(day + "T00:00:00");
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((d.getTime() - t0.getTime()) / 86400000);
  const base = d.toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "long" });
  if (diff === 0) return "Heute · " + base;
  if (diff === 1) return "Morgen · " + base;
  return base;
}

function evTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}
