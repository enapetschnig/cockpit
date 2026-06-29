"use client";

import { useEffect, useState } from "react";
import type { AdAccountDTO, AdDraftDTO, AdLocation, AdInterest, LeadDTO, LeadStageDTO } from "@/lib/types";
import type { OverviewTotals, OverviewCampaign, AdRow, SavedAudience, LeadFormRow } from "@/lib/meta";
import { rate, overallRating, adTips, SPECS } from "@/lib/adRating";
import { supabaseBrowser } from "@/lib/supabase/client";

const json = { "Content-Type": "application/json" };
function eur(n: number, dec = 0): string {
  return n.toLocaleString("de-AT", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " €";
}
function num(n: number): string {
  return Math.round(n).toLocaleString("de-AT");
}
// "vor 3 Std", "vor 2 Tagen", "gerade eben"
function fmtAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const std = Math.floor(min / 60);
  if (std < 24) return `vor ${std} Std`;
  const tg = Math.floor(std / 24);
  if (tg < 30) return `vor ${tg} ${tg === 1 ? "Tag" : "Tagen"}`;
  return new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}
// Farbiger Bewertungspunkt (gut/okay/schwach) zu einer Kennzahl
function RateDot({ metric, value }: { metric: string; value: number | null }) {
  const r = rate(metric, value);
  if (r.level === "na") return null;
  return <span className="rate-dot" style={{ background: r.color }} title={r.short} />;
}
// CTR + Bewertungspunkt (für Listen/Karten)
function ctrBadge(ctr: number | null) {
  return <span className="wmetric"><b>{ctr != null ? ctr.toFixed(1) + "%" : "–"}</b> CTR <RateDot metric="ctr" value={ctr} /></span>;
}
const GOALS: { v: string; t: string; sub: string; icon: string }[] = [
  { v: "leads", t: "Anfragen / Leads", sub: "Kontaktdaten sammeln", icon: "M3 7l9 6 9-6M3 5h18v14H3z" },
  { v: "appointments", t: "Termine", sub: "Terminanfragen", icon: "M3 4h18v17H3zM3 9h18M8 2v4M16 2v4" },
  { v: "jobs", t: "Mitarbeiter", sub: "Bewerbungen", icon: "M9 8a3 3 0 1 0 0-.01M3.5 19a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6" },
  { v: "traffic", t: "Website-Besuche", sub: "Mehr Besucher", icon: "M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" },
];
const BUDGETS = [10, 20, 30, 50, 100];
const RANGE_PRESETS = [
  { k: "last_7d", t: "Letzte 7 Tage" },
  { k: "last_30d", t: "Letzte 30 Tage" },
  { k: "last_90d", t: "Letzte 90 Tage" },
  { k: "this_month", t: "Dieser Monat" },
  { k: "last_month", t: "Letzter Monat" },
  { k: "this_year", t: "Dieses Jahr" },
  { k: "maximum", t: "Gesamter Zeitraum" },
];
function lastMonths(n: number): { k: string; t: string; since: string; until: string }[] {
  const now = new Date();
  const out: { k: string; t: string; since: string; until: string }[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    const mm = String(m + 1).padStart(2, "0");
    const lastDay = new Date(y, m + 1, 0).getDate();
    const t = d.toLocaleDateString("de-AT", { month: "long", year: "numeric" });
    out.push({ k: `m_${y}-${mm}`, t: t.charAt(0).toUpperCase() + t.slice(1), since: `${y}-${mm}-01`, until: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` });
  }
  return out;
}
const DRAFT_STATUS: Record<string, { label: string; cls: string }> = {
  needs_review: { label: "Entwurf", cls: "p-acct" },
  awaiting_review: { label: "Wartet auf Freigabe", cls: "p-none" },
  approved: { label: "Freigegeben", cls: "l-ang" },
  rejected: { label: "Abgelehnt", cls: "p-none" },
  launch_error: { label: "Fehler", cls: "p-none" },
  launched: { label: "Geschaltet", cls: "l-ang" },
};
const CHANNELS: { v: string; t: string }[] = [
  { v: "call", t: "📞 Anruf" },
  { v: "whatsapp", t: "💬 WhatsApp" },
  { v: "visit", t: "🏠 Vor-Ort-Termin" },
  { v: "email", t: "✉️ E-Mail" },
  { v: "note", t: "📝 Notiz" },
];
const NAV = [
  { label: "Posteingang", href: "/", icon: "M3 7l9 6 9-6M3 5h18v14H3z" },
  { label: "Kunden", href: "/?view=kunden", icon: "M9 8a3 3 0 1 0 0-.01M3.5 19a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6" },
  { label: "Kalender", href: "/?view=kalender", icon: "M3 4.5h18v16H3zM3 9h18M8 2.5v4M16 2.5v4" },
  { label: "Werbung", href: "/werbung", icon: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6" },
  { label: "Buchhaltung", href: "/buchhaltung", icon: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6" },
];

type Form = {
  adAccountId: string; goal: string; offer: string; benefit: string; region: string;
  locations: AdLocation[]; interests: AdInterest[]; gender: string; ageMin: number; ageMax: number;
  tone: string; budget: number; destination: string; privacyUrl: string; websiteUrl: string; imageUrl: string; leadFormId: string;
};
const emptyForm: Form = {
  adAccountId: "", goal: "leads", offer: "", benefit: "", region: "", locations: [], interests: [],
  gender: "", ageMin: 25, ageMax: 65, tone: "du", budget: 20, destination: "lead_form", privacyUrl: "", websiteUrl: "", imageUrl: "", leadFormId: "",
};


export default function Werbung() {
  const [accounts, setAccounts] = useState<AdAccountDTO[]>([]);
  const [drafts, setDrafts] = useState<AdDraftDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [selId, setSelId] = useState("");
  const [rangeKey, setRangeKey] = useState("last_30d");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [appliedCustom, setAppliedCustom] = useState<{ since: string; until: string } | null>(null);
  const [months] = useState(() => lastMonths(8));
  const [activeOnly, setActiveOnly] = useState(false);
  const [tab, setTab] = useState<"overview" | "ads" | "leads">("overview");

  const [totals, setTotals] = useState<OverviewTotals | null>(null);
  const [campaigns, setCampaigns] = useState<OverviewCampaign[]>([]);
  const [ads, setAds] = useState<AdRow[]>([]);
  const [selAd, setSelAd] = useState<AdRow | null>(null);
  const [adBusy, setAdBusy] = useState<string | null>(null);
  const [audiences, setAudiences] = useState<SavedAudience[]>([]);
  const [leadForms, setLeadForms] = useState<LeadFormRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [role, setRole] = useState<"admin" | "customer" | null>(null);
  // CRM
  const [crmLeads, setCrmLeads] = useState<LeadDTO[]>([]);
  const [crmCounts, setCrmCounts] = useState<Record<string, number>>({});
  const [crmUnseen, setCrmUnseen] = useState(0);
  const [crmFilter, setCrmFilter] = useState("alle");
  const [selLead, setSelLead] = useState<LeadDTO | null>(null);
  const [crmSyncing, setCrmSyncing] = useState(false);
  const [actDraft, setActDraft] = useState<{ channel: string; note: string }>({ channel: "call", note: "" });
  const [stages, setStages] = useState<LeadStageDTO[]>([]);
  const [showStages, setShowStages] = useState(false);
  const [newStage, setNewStage] = useState<{ label: string; color: string }>({ label: "", color: "#2f6df0" });

  const [mode, setMode] = useState<"dashboard" | "wizard">("dashboard");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>(emptyForm);
  const [draft, setDraft] = useState<AdDraftDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTune, setShowTune] = useState(false);
  const [locQuery, setLocQuery] = useState("");
  const [locResults, setLocResults] = useState<{ key: string; name: string; type: string; region?: string; country?: string }[]>([]);
  const [intQuery, setIntQuery] = useState("");
  const [intResults, setIntResults] = useState<{ id: string; name: string; audienceSize?: number; path?: string }[]>([]);

  function flash(t: string) { setToast(t); setTimeout(() => setToast(null), 3500); }
  // Query-Fragment für den gewählten Zeitraum (Preset, Monat oder eigener Bereich).
  function rangeQuery(): string {
    if (rangeKey === "custom") return appliedCustom ? `&since=${appliedCustom.since}&until=${appliedCustom.until}` : "&preset=last_30d";
    if (rangeKey.startsWith("m_")) {
      const m = months.find((x) => x.k === rangeKey);
      if (m) return `&since=${m.since}&until=${m.until}`;
    }
    return `&preset=${rangeKey}`;
  }
  const rangeLabel = rangeKey === "custom" ? (appliedCustom ? `${appliedCustom.since} – ${appliedCustom.until}` : "Eigener Zeitraum") : (RANGE_PRESETS.find((p) => p.k === rangeKey)?.t || months.find((m) => m.k === rangeKey)?.t || "");

  async function loadAccounts() {
    setLoading(true);
    try {
      const d = await (await fetch("/api/ads")).json();
      const accs: AdAccountDTO[] = d.accounts || [];
      setAccounts(accs);
      setDrafts(d.drafts || []);
      const first = accs.find((a) => a.hasToken) || accs[0];
      if (first && !selId) setSelId(first.id);
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  useEffect(() => {
    loadAccounts();
    fetch("/api/me").then((r) => r.json()).then((d) => setRole(d.role || null)).catch(() => {});
  }, []);
  async function logout() {
    await supabaseBrowser().auth.signOut().catch(() => {});
    window.location.href = "/login";
  }
  function loadDraftIntoWizard(d: AdDraftDTO) {
    setForm({ ...emptyForm, adAccountId: d.adAccountId, goal: d.goal, offer: d.offer, region: d.region, tone: d.tone, budget: d.budget, destination: d.destination, privacyUrl: d.privacyUrl || "", websiteUrl: d.websiteUrl || "", imageUrl: d.imageUrl || "", locations: d.locations, interests: d.interests, gender: d.gender || "", ageMin: d.ageMin, ageMax: d.ageMax, benefit: d.benefit || "" });
    setDraft(d);
    setStep(4);
    setMode("wizard");
  }
  async function reviewDraft(id: string, action: "approve" | "reject") {
    const reviewComment = action === "reject" ? window.prompt("Grund der Ablehnung (optional):") ?? "" : "";
    try {
      await fetch(`/api/ads/draft/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ review: action, reviewComment }) });
      flash(action === "approve" ? "Freigegeben." : "Abgelehnt.");
      loadAccounts();
    } catch { flash("Aktion fehlgeschlagen."); }
  }

  // Kennzahlen + aktuellen Tab laden, wenn Konto/Zeitraum/Filter wechseln
  useEffect(() => {
    if (!selId) return;
    const q = rangeQuery();
    const a = activeOnly ? "&active=1" : "";
    setDataLoading(true);
    fetch(`/api/ads/overview?accountId=${selId}${q}${a}`)
      .then((r) => r.json())
      .then((d) => { setTotals(d.totals || null); setCampaigns(d.campaigns || []); })
      .catch(() => {})
      .finally(() => setDataLoading(false));
    setAds([]);
    fetch(`/api/ads/audiences?accountId=${selId}`).then((r) => r.json()).then((d) => setAudiences(d.audiences || [])).catch(() => {});
    fetch(`/api/ads/forms?accountId=${selId}`).then((r) => r.json()).then((d) => setLeadForms(d.forms || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, rangeKey, appliedCustom, activeOnly]);

  useEffect(() => {
    if (!selId) return;
    const q = rangeQuery();
    const a = activeOnly ? "&active=1" : "";
    if (tab === "ads" && ads.length === 0) {
      fetch(`/api/ads/list?accountId=${selId}${q}${a}`).then((r) => r.json()).then((d) => setAds(d.ads || [])).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selId]);

  // CRM-Leads laden (persistiert), wenn der Leads-Tab offen ist / Filter wechselt
  useEffect(() => {
    if (!selId || tab !== "leads") return;
    loadCrm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selId, crmFilter]);

  // Pipeline-Stufen je Konto laden (für CRM-Farben + Statuszähler im Tab)
  useEffect(() => {
    if (!selId) { setStages([]); return; }
    loadStages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  async function loadCrm() {
    try {
      const d = await (await fetch(`/api/leads?accountId=${selId}&status=${crmFilter}`)).json();
      setCrmLeads(d.leads || []);
      setCrmCounts(d.counts || {});
      setCrmUnseen(d.unseen || 0);
    } catch { /* ignore */ }
  }
  async function loadStages() {
    try {
      const st = await (await fetch(`/api/leads/stages?accountId=${selId}`)).json();
      if (st?.stages) setStages(st.stages);
    } catch { /* ignore */ }
  }
  async function addStage() {
    if (!newStage.label.trim()) return;
    try {
      const d = await (await fetch("/api/leads/stages", { method: "POST", headers: json, body: JSON.stringify({ accountId: selId, label: newStage.label, color: newStage.color }) })).json();
      if (d.stage) { setStages((s) => [...s, d.stage]); setNewStage({ label: "", color: "#2f6df0" }); }
      else if (d.error) flash(d.error);
    } catch { /* ignore */ }
  }
  async function updateStage(id: string, fields: { label?: string; color?: string }) {
    setStages((s) => s.map((x) => (x.id === id ? { ...x, ...fields } : x)));
    try { await fetch(`/api/leads/stages/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(fields) }); } catch { /* ignore */ }
  }
  async function deleteStage(id: string) {
    try {
      const d = await (await fetch(`/api/leads/stages/${id}`, { method: "DELETE" })).json();
      if (d.ok) { setStages((s) => s.filter((x) => x.id !== id)); loadCrm(); }
      else if (d.error) flash(d.error);
    } catch { /* ignore */ }
  }
  function openLead(l: LeadDTO) {
    setSelLead(l);
    if (!l.seenAt) {
      setCrmUnseen((n) => Math.max(0, n - 1));
      setCrmLeads((ls) => ls.map((x) => (x.id === l.id ? { ...x, seenAt: new Date().toISOString() } : x)));
      fetch(`/api/leads/${l.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ seen: true }) }).catch(() => {});
    }
  }
  function stageOf(key: string): LeadStageDTO {
    return stages.find((s) => s.key === key) || { id: "", key, label: key, color: "#6b7280", order: 99, isDefault: false };
  }
  // Anzeige pausieren/aktivieren (Pausieren: alle; Aktivieren: nur Admin – serverseitig geprüft)
  async function toggleAd(ad: AdRow, e?: React.MouseEvent) {
    e?.stopPropagation();
    const next = ad.effectiveStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setAdBusy(ad.id);
    try {
      const d = await (await fetch("/api/ads/status", { method: "POST", headers: json, body: JSON.stringify({ accountId: selId, adId: ad.id, status: next }) })).json();
      if (d.ok) {
        const es: string = d.effectiveStatus || next;
        setAds((list) => {
          const mapped = list.map((x) => (x.id === ad.id ? { ...x, effectiveStatus: es } : x));
          return activeOnly && es !== "ACTIVE" ? mapped.filter((x) => x.id !== ad.id) : mapped;
        });
        setSelAd((s) => (s && s.id === ad.id ? { ...s, effectiveStatus: es } : s));
        flash(next === "PAUSED" ? "Anzeige pausiert." : "Anzeige aktiviert.");
      } else flash(d.error || "Aktion fehlgeschlagen.");
    } catch { flash("Aktion fehlgeschlagen."); } finally { setAdBusy(null); }
  }
  const canManage = role !== "customer"; // Admin (oder Bestandsinhaber) darf auch aktivieren
  async function syncCrm() {
    setCrmSyncing(true);
    try {
      const d = await (await fetch("/api/ads/sync/leads", { method: "POST", headers: json, body: JSON.stringify({ accountId: selId }) })).json();
      const r = (d.results || [])[0];
      await loadCrm();
      flash(r?.error ? "Hinweis: " + r.error : `${r?.created ?? 0} neue Leads geladen.`);
    } catch { flash("Aktualisieren fehlgeschlagen."); } finally { setCrmSyncing(false); }
  }
  async function patchLead(id: string, fields: Record<string, unknown>) {
    try {
      const d = await (await fetch(`/api/leads/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(fields) })).json();
      if (d.id) { setSelLead(d); setCrmLeads((ls) => ls.map((l) => (l.id === d.id ? d : l))); loadCrm(); }
    } catch { /* ignore */ }
  }
  async function addActivity(id: string) {
    if (!actDraft.note.trim()) return;
    try {
      const d = await (await fetch(`/api/leads/${id}/activity`, { method: "POST", headers: json, body: JSON.stringify(actDraft) })).json();
      if (d.id) { setSelLead(d); setCrmLeads((ls) => ls.map((l) => (l.id === d.id ? d : l))); setActDraft({ channel: "call", note: "" }); loadCrm(); }
    } catch { /* ignore */ }
  }

  async function sync() {
    setSyncing(true);
    try {
      await fetch("/api/ads/sync", { method: "POST", headers: json, body: JSON.stringify({ accountId: selId }) });
      const q = rangeQuery();
      const a = activeOnly ? "&active=1" : "";
      const d = await (await fetch(`/api/ads/overview?accountId=${selId}${q}${a}`)).json();
      setTotals(d.totals || null); setCampaigns(d.campaigns || []);
      flash("Frisch von Meta geladen.");
    } catch { flash("Aktualisieren fehlgeschlagen."); } finally { setSyncing(false); }
  }

  // ── FB-Suche (Wizard) ──
  useEffect(() => {
    const q = locQuery.trim();
    if (q.length < 2) { setLocResults([]); return; }
    const t = setTimeout(async () => {
      try { const d = await (await fetch(`/api/ads/targeting?kind=location&q=${encodeURIComponent(q)}&accountId=${form.adAccountId}`)).json(); setLocResults(d.results || []); } catch { /* */ }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locQuery]);
  useEffect(() => {
    const q = intQuery.trim();
    if (q.length < 2) { setIntResults([]); return; }
    const t = setTimeout(async () => {
      try { const d = await (await fetch(`/api/ads/targeting?kind=interest&q=${encodeURIComponent(q)}&accountId=${form.adAccountId}`)).json(); setIntResults(d.results || []); } catch { /* */ }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intQuery]);

  function startWizard() {
    setForm({ ...emptyForm, adAccountId: selId });
    setDraft(null); setStep(1); setShowTune(false);
    setLocQuery(""); setLocResults([]); setIntQuery(""); setIntResults([]);
    setMode("wizard");
  }
  function exitWizard() { setMode("dashboard"); setDraft(null); loadAccounts(); }

  const connected = accounts.filter((a) => a.hasToken);
  const sel = accounts.find((a) => a.id === selId);

  return (
    <div className="wpage">
      <aside className="wnav">
        <div className="wnav-brand">ePower Cockpit</div>
        {(role === "customer" ? NAV.filter((n) => n.label === "Werbung") : NAV).map((n) => (
          <a key={n.label} href={n.href} className={"wnav-i" + (n.label === "Werbung" ? " active" : "")}>
            <svg viewBox="0 0 24 24"><path d={n.icon} /></svg>{n.label}
          </a>
        ))}
        <button className="wnav-i wnav-logout" onClick={logout}>
          <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>Abmelden
        </button>
      </aside>

      <main className="wmain">
        {toast && <div className="wtoast">{toast}</div>}

        {selAd && (
          <div className="crm-overlay" onClick={() => setSelAd(null)}>
            <div className="crm-panel" onClick={(e) => e.stopPropagation()}>
              <div className="crm-top">
                <div className="wad-detail-head">
                  {selAd.thumbnailUrl ? <img src={selAd.thumbnailUrl} alt="" className="wad-detail-thumb" /> : <div className="wad-detail-thumb ph">{selAd.objectType === "VIDEO" ? "▶" : "▦"}</div>}
                  <div>
                    <h3>{selAd.name}</h3>
                    <div className="wmuted" style={{ fontSize: 13 }}>
                      <span className={"wad-status " + (selAd.effectiveStatus === "ACTIVE" ? "on" : "off")}>{selAd.effectiveStatus === "ACTIVE" ? "● aktiv" : "❚❚ pausiert"}</span>
                      {selAd.campaign ? " · " + selAd.campaign : ""}{selAd.objectType === "VIDEO" ? " · Video" : ""}
                    </div>
                  </div>
                </div>
                <button className="crm-x" onClick={() => setSelAd(null)}>✕</button>
              </div>
              {(() => { const o = overallRating({ ctr: selAd.ctr, cpl: selAd.cpl, frequency: selAd.frequency }); return (
                <div className="wad-overall" style={{ borderColor: o.color, color: o.color }}><span className="rate-dot lg" style={{ background: o.color }} />Gesamtbewertung: <b>{o.short}</b></div>
              ); })()}
              <div className="wad-detail-grid">
                <AdStat v={eur(selAd.spend, 2)} l="Ausgaben" sub="im Zeitraum" />
                <AdStat v={String(selAd.leads)} l="Leads" sub="Anfragen erhalten" />
                <AdStat v={selAd.cpl != null ? eur(selAd.cpl, 2) : "–"} l="Kosten / Lead" sub="pro Anfrage" metric="cpl" value={selAd.cpl} />
                <AdStat v={selAd.ctr != null ? selAd.ctr.toFixed(2) + "%" : "–"} l="CTR" sub="Klickrate (Klicks ÷ Einblendungen)" metric="ctr" value={selAd.ctr} />
                <AdStat v={num(selAd.reach)} l="Reichweite" sub="erreichte Personen" />
                <AdStat v={num(selAd.impressions)} l="Impressionen" sub="Einblendungen gesamt" />
                <AdStat v={num(selAd.clicks)} l="Klicks" sub="alle Klicks" />
                <AdStat v={num(selAd.linkClicks)} l="Link-Klicks" sub="Klicks auf den Link" />
                <AdStat v={selAd.cpc != null ? eur(selAd.cpc, 2) : "–"} l="CPC" sub="Kosten pro Klick" metric="cpc" value={selAd.cpc} />
                <AdStat v={selAd.cpm != null ? eur(selAd.cpm, 2) : "–"} l="CPM" sub="Kosten / 1.000 Einbl." metric="cpm" value={selAd.cpm} />
                <AdStat v={selAd.frequency != null ? selAd.frequency.toFixed(1) + "×" : "–"} l="Frequenz" sub="Ø Einblendungen / Person" metric="frequency" value={selAd.frequency} />
              </div>
              {(() => { const tips = adTips({ ctr: selAd.ctr, cpl: selAd.cpl, cpc: selAd.cpc, cpm: selAd.cpm, frequency: selAd.frequency }); return tips.length > 0 ? (
                <div className="wad-tips">
                  <div className="wad-tips-h">💡 Tipps zur Verbesserung</div>
                  {tips.map((t, i) => <div key={i} className="wad-tip"><b>{t.label}:</b> {t.text}</div>)}
                </div>
              ) : (selAd.ctr != null || selAd.cpl != null) ? (
                <div className="wad-tips ok"><div className="wad-tip">👍 Diese Anzeige läuft rund – keine dringenden Baustellen.</div></div>
              ) : null; })()}
              {(selAd.effectiveStatus === "ACTIVE" || canManage) && (
                <button className={"wbtn " + (selAd.effectiveStatus === "ACTIVE" ? "danger" : "primary")} style={{ width: "100%", marginTop: 14 }} disabled={adBusy === selAd.id} onClick={() => toggleAd(selAd)}>
                  {adBusy === selAd.id ? "…" : selAd.effectiveStatus === "ACTIVE" ? "⏸ Anzeige pausieren" : "▶ Anzeige aktivieren"}
                </button>
              )}
              <div className="wmuted" style={{ fontSize: 12, marginTop: 12 }}>Zeitraum: {rangeLabel}</div>
            </div>
          </div>
        )}

        {selLead && (
          <div className="crm-overlay" onClick={() => setSelLead(null)}>
            <div className="crm-panel" onClick={(e) => e.stopPropagation()}>
              <div className="crm-top">
                <div>
                  <h3>{selLead.name || "(ohne Namen)"}</h3>
                  <div className="crm-sub">{selLead.leadFormName || "Lead"} · eingegangen {fmtAgo(selLead.receivedAt)}</div>
                </div>
                <button className="crm-x" onClick={() => setSelLead(null)}>×</button>
              </div>
              <div className="crm-contact">
                {selLead.phone && <a href={`tel:${selLead.phone}`}>📞 {selLead.phone}</a>}
                {selLead.email && <a href={`mailto:${selLead.email}`}>✉️ {selLead.email}</a>}
                {selLead.city && <span>📍 {selLead.city}</span>}
              </div>
              {selLead.fields.length > 0 && (
                <div className="crm-fields">
                  {selLead.fields.map((f, i) => <div key={i}><span>{f.key}</span><b>{f.value}</b></div>)}
                </div>
              )}

              <label className="wlbl">Status in der Pipeline</label>
              <div className="wstage-pick">
                {stages.map((s) => (
                  <button key={s.key} className={"wstage-opt" + (selLead.status === s.key ? " on" : "")} style={selLead.status === s.key ? { background: s.color, borderColor: s.color, color: "#fff" } : { borderColor: s.color, color: s.color }} onClick={() => patchLead(selLead.id, { status: s.key })}>{s.label}</button>
                ))}
              </div>

              <label className="wlbl">Vor-Ort-/Rückruf-Termin</label>
              <input className="winp" type="datetime-local" value={selLead.scheduledFor ? selLead.scheduledFor.slice(0, 16) : ""} onChange={(e) => patchLead(selLead.id, { scheduledFor: e.target.value ? new Date(e.target.value).toISOString() : null })} />

              <label className="wlbl">Notizen</label>
              <textarea className="winp" rows={3} defaultValue={selLead.notes || ""} key={selLead.id + "-notes"} onBlur={(e) => { if (e.target.value !== (selLead.notes || "")) patchLead(selLead.id, { notes: e.target.value }); }} />

              <div className="ad-sep">Kontakt-Log</div>
              <div className="addrow">
                <select className="winp" style={{ flex: "none", width: 150 }} value={actDraft.channel} onChange={(e) => setActDraft({ ...actDraft, channel: e.target.value })}>
                  {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.t}</option>)}
                </select>
                <input className="winp" placeholder="Was wurde besprochen?" value={actDraft.note} onChange={(e) => setActDraft({ ...actDraft, note: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addActivity(selLead.id)} />
                <button className="wbtn primary" style={{ flex: "none" }} onClick={() => addActivity(selLead.id)}>+</button>
              </div>
              {selLead.activities.length > 0 && (
                <div className="crm-log">
                  {selLead.activities.map((a) => (
                    <div key={a.id} className="crm-log-i">
                      <div className="crm-log-h"><b>{CHANNELS.find((c) => c.v === a.channel)?.t || a.channel}</b><span>{a.createdAt.slice(0, 16).replace("T", " ")}</span></div>
                      <div>{a.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "wizard" ? (
          <Wizard
            form={form} setForm={setForm} step={step} setStep={setStep} exitWizard={exitWizard} role={role}
            accounts={connected} draft={draft} setDraft={setDraft} busy={busy} setBusy={setBusy} flash={flash}
            showTune={showTune} setShowTune={setShowTune} audiences={audiences} leadForms={leadForms}
            locQuery={locQuery} setLocQuery={setLocQuery} locResults={locResults} setLocResults={setLocResults}
            intQuery={intQuery} setIntQuery={setIntQuery} intResults={intResults} setIntResults={setIntResults}
          />
        ) : (
          <>
            <div className="whead">
              <div>
                <h1>Werbeanzeigen</h1>
                <p>Deine Kennzahlen auf einen Blick.</p>
              </div>
              <div className="whead-actions">
                <button className="wbtn ghost" disabled={syncing} onClick={sync}>{syncing ? "…" : "↻"}</button>
                <button className="wbtn primary" onClick={startWizard} disabled={!connected.length}>+ Neue Anzeige</button>
              </div>
            </div>

            {loading ? (
              <div className="wmuted">Lade …</div>
            ) : accounts.length === 0 ? (
              <div className="wmuted">Noch kein Werbekonto verbunden. Verbinde es unter <a href="/connect">/connect</a>.</div>
            ) : (
              <>
                <div className="wctrls">
                  {accounts.length > 1 && (
                    <div className="wpills">
                      {accounts.map((a) => (
                        <button key={a.id} className={"wpill" + (a.id === selId ? " on" : "")} onClick={() => setSelId(a.id)}>{a.label}</button>
                      ))}
                    </div>
                  )}
                  <div className="wctrl-row">
                    <select className="wrange" value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} aria-label="Zeitraum">
                      {RANGE_PRESETS.map((p) => <option key={p.k} value={p.k}>{p.t}</option>)}
                      <optgroup label="Einzelne Monate">
                        {months.map((m) => <option key={m.k} value={m.k}>{m.t}</option>)}
                      </optgroup>
                      <option value="custom">Eigener Zeitraum …</option>
                    </select>
                    <button className={"wchip toggle" + (activeOnly ? " on" : "")} onClick={() => setActiveOnly(!activeOnly)}>● Nur aktive</button>
                  </div>
                  {rangeKey === "custom" && (
                    <div className="wdates">
                      <input type="date" value={customSince} onChange={(e) => setCustomSince(e.target.value)} />
                      <span>bis</span>
                      <input type="date" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} />
                      <button className="wbtn ghost sm" disabled={!customSince || !customUntil} onClick={() => setAppliedCustom({ since: customSince, until: customUntil })}>Anwenden</button>
                    </div>
                  )}
                </div>

                {sel?.status === "error" && <div className="ad-err">Verbindung fehlt: {sel.lastError || "Token abgelaufen"}. Neu verbinden über <a href="/connect">/connect</a>.</div>}

                <div className="wrange-cap">Zeitraum: <b>{rangeLabel}</b></div>
                <div className="wkpis">
                  <Kpi v={totals ? eur(totals.spend) : "–"} l="Ausgaben" sub="im Zeitraum" big />
                  <Kpi v={totals ? num(totals.leads) : "–"} l="Leads" sub="Anfragen erhalten" big />
                  <Kpi v={totals?.cpl != null ? eur(totals.cpl) : "–"} l="Kosten / Lead" sub="pro Anfrage" rating={totals?.cpl != null ? rate("cpl", totals.cpl) : undefined} />
                  <Kpi v={totals?.ctr != null ? totals.ctr.toFixed(1) + "%" : "–"} l="CTR" sub="Klickrate" rating={totals?.ctr != null ? rate("ctr", totals.ctr) : undefined} />
                  <Kpi v={totals ? num(totals.reach) : "–"} l="Reichweite" sub="erreichte Personen" />
                  <Kpi v={totals ? num(totals.impressions) : "–"} l="Impressionen" sub="Einblendungen" />
                </div>

                <div className="wtabs">
                  {([["overview", "Übersicht"], ["ads", "Anzeigen"], ["leads", "Leads"]] as ["overview" | "ads" | "leads", string][]).map(([v, l]) => (
                    <button key={v} className={"wtab" + (tab === v ? " on" : "")} onClick={() => setTab(v)}>
                      {l}{v === "leads" && crmUnseen > 0 && <span className="wtab-badge">{crmUnseen}</span>}
                    </button>
                  ))}
                </div>

                {tab === "overview" && (
                  dataLoading && !campaigns.length ? <div className="wmuted">Lade Kennzahlen …</div> :
                  campaigns.length === 0 ? <div className="wmuted">{activeOnly ? "Keine aktiven Kampagnen im Zeitraum." : "Keine Kampagnen im Zeitraum."}</div> :
                  <div className="wgrid">
                    {campaigns.map((c) => (
                      <div key={c.id} className="wcamp">
                        <div className="wcamp-top">
                          <span className={"ampel ad-" + c.health.state} title={c.health.reason}>{c.health.label}</span>
                          <span className="wcamp-name">{c.name}</span>
                        </div>
                        <div className="wcamp-metrics">
                          <div><b>{eur(c.spend)}</b><span>Ausgaben</span></div>
                          <div><b>{num(c.leads)}</b><span>Leads</span></div>
                          <div><b>{c.cpl != null ? eur(c.cpl) : "–"}</b><span>/Lead</span></div>
                          <div><b>{c.ctr != null ? c.ctr.toFixed(1) + "%" : "–"} <RateDot metric="ctr" value={c.ctr} /></b><span>CTR</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "ads" && (
                  ads.length === 0 ? <div className="wmuted">{dataLoading ? "Lade Anzeigen …" : activeOnly ? "Keine aktiven Anzeigen." : "Keine Anzeigen im Zeitraum."}</div> :
                  <div className="wads">
                    {[...ads].sort((a, b) => (b.effectiveStatus === "ACTIVE" ? 1 : 0) - (a.effectiveStatus === "ACTIVE" ? 1 : 0)).map((ad) => {
                      const active = ad.effectiveStatus === "ACTIVE";
                      return (
                        <div key={ad.id} className="wad" onClick={() => setSelAd(ad)}>
                          <div className="wad-thumb">{ad.thumbnailUrl ? <img src={ad.thumbnailUrl} alt="" /> : <span>{ad.objectType === "VIDEO" ? "▶" : "▦"}</span>}</div>
                          <div className="wad-main">
                            <div className="wad-name">{ad.name}</div>
                            <div className="wad-sub"><span className={"wad-status " + (active ? "on" : "off")}>{active ? "● aktiv" : "❚❚ pausiert"}</span>{ad.campaign ? " · " + ad.campaign : ""}{ad.objectType === "VIDEO" ? " · Video" : ""}</div>
                            <div className="wad-metrics"><span><b>{eur(ad.spend)}</b> Ausgaben</span><span><b>{ad.leads}</b> Leads</span><span><b>{ad.cpl != null ? eur(ad.cpl) : "–"}</b>/Lead</span>{ctrBadge(ad.ctr)}</div>
                          </div>
                          {(active || canManage) && (
                            <button className={"wad-toggle " + (active ? "pause" : "play")} disabled={adBusy === ad.id} title={active ? "Pausieren" : "Aktivieren"} onClick={(e) => toggleAd(ad, e)}>
                              {adBusy === ad.id ? "…" : active ? "⏸" : "▶"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {tab === "leads" && (
                  <>
                    {crmUnseen > 0 && <div className="wnew-banner">🔔 {crmUnseen} {crmUnseen === 1 ? "neuer Lead" : "neue Leads"} – noch nicht angesehen</div>}
                    <div className="wcrm-head">
                      <div className="wlead-sum">{crmLeads.length} Leads im CRM</div>
                      <div className="wcrm-actions">
                        <button className="wbtn ghost sm" onClick={() => setShowStages((v) => !v)}>{showStages ? "Fertig" : "⚙ Pipeline"}</button>
                        <button className="wbtn ghost sm" disabled={crmSyncing} onClick={syncCrm}>{crmSyncing ? "…" : "↻ Leads holen"}</button>
                      </div>
                    </div>

                    {showStages && (
                      <div className="wstages-mgr">
                        <div className="wstages-title">Pipeline-Stufen</div>
                        {stages.map((s) => (
                          <div key={s.id} className="wstage-row">
                            <input type="color" value={s.color} onChange={(e) => updateStage(s.id, { color: e.target.value })} aria-label="Farbe" />
                            <input className="winp sm" defaultValue={s.label} key={s.id + s.label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.label) updateStage(s.id, { label: v }); }} />
                            {s.isDefault ? <span className="wstage-lock" title="Standard-Stufe">Standard</span> : <button className="wstage-del" title="Löschen" onClick={() => deleteStage(s.id)}>✕</button>}
                          </div>
                        ))}
                        <div className="wstage-row add">
                          <input type="color" value={newStage.color} onChange={(e) => setNewStage({ ...newStage, color: e.target.value })} aria-label="Farbe" />
                          <input className="winp sm" placeholder="Neue Stufe (z.B. Angebot gesendet)" value={newStage.label} onChange={(e) => setNewStage({ ...newStage, label: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addStage()} />
                          <button className="wbtn primary sm" onClick={addStage} disabled={!newStage.label.trim()}>+ Hinzufügen</button>
                        </div>
                      </div>
                    )}

                    <div className="wchips" style={{ flexWrap: "wrap", marginBottom: 12 }}>
                      <button className={"wchip" + (crmFilter === "alle" ? " on" : "")} onClick={() => setCrmFilter("alle")}>Alle ({Object.values(crmCounts).reduce((a, b) => a + b, 0)})</button>
                      {stages.map((s) => (
                        <button key={s.key} className="wchip-stage" style={crmFilter === s.key ? { background: s.color, borderColor: s.color, color: "#fff" } : { borderColor: s.color, color: s.color }} onClick={() => setCrmFilter(s.key)}>
                          {s.label}{crmCounts[s.key] ? ` (${crmCounts[s.key]})` : ""}
                        </button>
                      ))}
                    </div>
                    {crmLeads.length === 0 ? (
                      <div className="wmuted">Noch keine Leads. Tippe „↻ Leads holen", um sie aus Facebook zu laden.</div>
                    ) : (
                      <div className="wleads">
                        {crmLeads.map((l) => {
                          const st = stageOf(l.status);
                          return (
                            <div key={l.id} className={"wlead crm" + (!l.seenAt ? " unseen" : "")} onClick={() => { openLead(l); setActDraft({ channel: "call", note: "" }); }}>
                              <div className="wlead-main">{!l.seenAt && <span className="wlead-dot" title="neu" />}<b>{l.name || "(ohne Namen)"}</b>{l.phone ? " · " + l.phone : ""}</div>
                              <div className="wlead-meta">{fmtAgo(l.receivedAt)}{l.leadFormName ? " · " + l.leadFormName : ""}{l.activities.length ? ` · ${l.activities.length} Kontakt(e)` : ""}</div>
                              <span className="wlead-stage" style={{ background: st.color }}>{st.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {role === "admin" && drafts.filter((d) => d.status === "awaiting_review").length > 0 && (
                  <div className="wcard" style={{ marginTop: 16, borderColor: "var(--amber)" }}>
                    <div className="wrecs-t">⏳ Zur Freigabe von Kunden</div>
                    {drafts.filter((d) => d.status === "awaiting_review").map((d) => (
                      <div key={d.id} className="wreview">
                        <div className="wreview-main" onClick={() => { loadDraftIntoWizard(d); }}>
                          <b>{d.offer}</b><span>{d.headline || ""} · {d.region}</span>
                        </div>
                        <div className="wreview-act">
                          <button className="wbtn primary" style={{ padding: "7px 11px" }} onClick={() => reviewDraft(d.id, "approve")}>✓ Freigeben</button>
                          <button className="wbtn ghost" style={{ padding: "7px 11px" }} onClick={() => reviewDraft(d.id, "reject")}>Ablehnen</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {drafts.filter((d) => d.status !== "launched" && d.status !== "awaiting_review").length > 0 && (
                  <div className="wcard" style={{ marginTop: 16 }}>
                    <div className="wrecs-t">Entwürfe</div>
                    {drafts.filter((d) => d.status !== "launched" && d.status !== "awaiting_review").map((d) => (
                      <div key={d.id} className="wdraft" onClick={() => loadDraftIntoWizard(d)}>
                        <span>{d.offer}</span><span className={"pill " + (DRAFT_STATUS[d.status]?.cls || "p-acct")}>{DRAFT_STATUS[d.status]?.label || "Entwurf"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function AdStat({ v, l, sub, metric, value }: { v: string; l: string; sub: string; metric?: string; value?: number | null }) {
  const r = metric ? rate(metric, value) : null;
  const tip = metric && r && r.level !== "na" ? `${SPECS[metric].explain}\n\n${r.text}` : sub;
  return (
    <div className="wad-stat" title={tip}>
      <div className="wad-stat-v">{v}{r && r.level !== "na" && <span className="rate-dot lg" style={{ background: r.color }} title={r.short} />}</div>
      <div className="wad-stat-l">{l}</div>
      {r && r.level !== "na" ? <div className="wad-stat-sub" style={{ color: r.color, fontWeight: 700 }}>{r.short}</div> : <div className="wad-stat-sub">{sub}</div>}
    </div>
  );
}

function Kpi({ v, l, sub, big, rating }: { v: string; l: string; sub?: string; big?: boolean; rating?: { level: string; short: string; color: string } }) {
  return (
    <div className={"wkpi" + (big ? " big" : "")}>
      <div className="wkpi-v">{v}</div>
      <div className="wkpi-l">{l}</div>
      {rating && rating.level !== "na" ? (
        <div className="wkpi-rate" style={{ color: rating.color }}><span className="rate-dot" style={{ background: rating.color }} />{rating.short}</div>
      ) : sub ? <div className="wkpi-sub">{sub}</div> : null}
    </div>
  );
}

// ── Wizard ──────────────────────────────────────────────────────────────
function Wizard(props: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void; step: number; setStep: (s: number) => void; exitWizard: () => void; role: "admin" | "customer" | null;
  accounts: AdAccountDTO[]; draft: AdDraftDTO | null; setDraft: (d: AdDraftDTO | null) => void; busy: boolean; setBusy: (b: boolean) => void; flash: (t: string) => void;
  showTune: boolean; setShowTune: (b: boolean) => void; audiences: SavedAudience[]; leadForms: LeadFormRow[];
  locQuery: string; setLocQuery: (s: string) => void; locResults: { key: string; name: string; type: string; region?: string; country?: string }[]; setLocResults: (r: never[]) => void;
  intQuery: string; setIntQuery: (s: string) => void; intResults: { id: string; name: string; audienceSize?: number; path?: string }[]; setIntResults: (r: never[]) => void;
}) {
  const { form, setForm, step, setStep, exitWizard, accounts, draft, setDraft, busy, setBusy, flash, audiences, leadForms, role } = props;
  const isCustomer = role === "customer";
  const [videoBusy, setVideoBusy] = useState(false);
  const STEPS = ["Ziel", "Zielgruppe", "Budget", "Text & schalten"];
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Live-Vorschau-Werte (Facebook-Stil)
  const CTA: Record<string, string> = { leads: "Anfrage senden", jobs: "Jetzt bewerben", appointments: "Termin anfragen", traffic: "Mehr erfahren" };
  const pageName = accounts.find((a) => a.id === form.adAccountId)?.label || "Deine Seite";
  const prevHeadline = (draft?.headline || form.offer || "Deine Überschrift").trim();
  const prevText = draft?.primaryText || "";
  const prevImage = draft?.imageUrl || form.imageUrl || "";
  const prevVideo = !!draft?.videoId;
  const prevCta = CTA[form.goal] || "Mehr erfahren";
  const dest = draft?.destination || form.destination;
  const linkUrl = dest === "website" ? draft?.websiteUrl || form.websiteUrl : draft?.privacyUrl || form.privacyUrl;
  let prevDomain = "Sofortformular";
  try { if (dest === "website" && linkUrl) prevDomain = new URL(linkUrl).host.replace(/^www\./, ""); } catch { /* */ }

  function addLocation(r: { key: string; name: string; type: string }) {
    if (form.locations.some((l) => l.key === r.key)) return;
    set({ locations: [...form.locations, { type: r.type, key: r.key, name: r.name, radiusKm: r.type === "city" ? 30 : undefined }], region: form.region || r.name });
    props.setLocQuery(""); props.setLocResults([]);
  }
  function addInterest(r: { id: string; name: string }) {
    if (form.interests.some((i) => i.id === r.id)) return;
    set({ interests: [...form.interests, { id: r.id, name: r.name }] });
    props.setIntQuery(""); props.setIntResults([]);
  }
  function applyAudience(a: SavedAudience) {
    const t = (a.targeting as Record<string, unknown>) || {};
    const geo = (t.geo_locations as Record<string, unknown>) || {};
    const locations: AdLocation[] = [];
    ((geo.regions as { key?: string; name?: string }[]) || []).forEach((r) => r.key && locations.push({ type: "region", key: String(r.key), name: r.name || "Region" }));
    ((geo.cities as { key?: string; name?: string; radius?: number }[]) || []).forEach((c) => c.key && locations.push({ type: "city", key: String(c.key), name: c.name || "Stadt", radiusKm: c.radius || 30 }));
    ((geo.countries as string[]) || []).forEach((c) => locations.push({ type: "country", key: c, name: c }));
    const interests: AdInterest[] = ((t.flexible_spec as { interests?: { id?: string; name?: string }[] }[]) || []).flatMap((f) => f.interests || []).filter((i) => i.id).map((i) => ({ id: String(i.id), name: i.name }));
    const genders = t.genders as number[] | undefined;
    set({ locations, interests, ageMin: (t.age_min as number) || form.ageMin, ageMax: (t.age_max as number) || form.ageMax, gender: genders?.[0] === 1 ? "men" : genders?.[0] === 2 ? "women" : "", region: form.region || locations[0]?.name || "" });
    flash(`Zielgruppe „${a.name}" übernommen.`);
  }

  const stepOk = (s: number): boolean => {
    if (s === 1) return !!form.adAccountId && form.offer.trim().length > 1;
    if (s === 2) return form.region.trim().length > 1 || form.locations.length > 0;
    if (s === 3) return form.destination === "website" ? /^https?:\/\//i.test(form.websiteUrl) : /^https?:\/\//i.test(form.privacyUrl);
    return true;
  };

  async function generate(mode: "ki" | "vorlage" = "ki") {
    setBusy(true);
    try {
      const d = await (await fetch("/api/ads/draft", { method: "POST", headers: json, body: JSON.stringify({ ...form, mode }) })).json();
      if (d.id) setDraft(d); else flash(d.error || "Entwurf fehlgeschlagen");
    } finally { setBusy(false); }
  }
  async function regen(mode: "ki" | "vorlage") {
    if (!draft) return; setBusy(true);
    try { const d = await (await fetch(`/api/ads/draft/${draft.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ regenerate: mode, tone: form.tone }) })).json(); if (d.id) setDraft(d); } finally { setBusy(false); }
  }
  async function next() {
    if (step === 3 && !draft) { setStep(4); await generate("ki"); return; }
    setStep(step + 1);
  }
  async function launch() {
    if (!draft) return; setBusy(true);
    try {
      await fetch(`/api/ads/draft/${draft.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ headline: draft.headline, primaryText: draft.primaryText, imageUrl: draft.imageUrl }) }).catch(() => {});
      const d = await (await fetch(`/api/ads/draft/${draft.id}/launch`, { method: "POST", headers: json })).json();
      if (d.ok) { flash("✅ Anzeige pausiert in Meta erstellt."); exitWizard(); }
      else { setDraft({ ...draft, status: "launch_error", launchError: d.error || "Fehlgeschlagen" }); flash("Meta: " + (d.error || "Fehlgeschlagen")); }
    } finally { setBusy(false); }
  }
  async function submitForReview() {
    if (!draft) return; setBusy(true);
    try {
      // aktuelle Edits sichern, dann zur Freigabe einreichen
      await fetch(`/api/ads/draft/${draft.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ headline: draft.headline, primaryText: draft.primaryText, imageUrl: draft.imageUrl }) }).catch(() => {});
      const d = await (await fetch(`/api/ads/draft/${draft.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ submit: true }) })).json();
      if (d.id) { flash("✅ An deinen Betreuer zur Freigabe gesendet."); exitWizard(); }
      else flash("Senden fehlgeschlagen.");
    } finally { setBusy(false); }
  }
  async function uploadVideo(file: File) {
    if (!draft) return;
    setVideoBusy(true);
    try {
      const sign = await (await fetch("/api/ads/video/sign", { method: "POST", headers: json, body: JSON.stringify({ accountId: form.adAccountId, filename: file.name }) })).json();
      if (!sign.ok) { flash(sign.error || "Upload-URL fehlgeschlagen"); return; }
      const up = await supabaseBrowser().storage.from(sign.url).uploadToSignedUrl(sign.path, sign.token, file);
      if (up.error) { flash("Hochladen fehlgeschlagen: " + up.error.message); return; }
      flash("Video wird zu Meta übertragen …");
      const att = await (await fetch("/api/ads/video/attach", { method: "POST", headers: json, body: JSON.stringify({ accountId: form.adAccountId, draftId: draft.id, path: sign.path, filename: file.name }) })).json();
      if (att.ok) { setDraft({ ...draft, videoId: att.videoId }); flash(att.ready ? "Video hochgeladen ✓" : "Video hochgeladen – Meta verarbeitet es noch."); }
      else flash("Meta: " + (att.error || "Video fehlgeschlagen"));
    } catch { flash("Video-Upload fehlgeschlagen."); }
    finally { setVideoBusy(false); }
  }

  return (
    <div className="wiz">
      <div className="wiz-head">
        <button className="wlink" onClick={exitWizard}>‹ Zurück zur Übersicht</button>
        <div className="wiz-steps">
          {STEPS.map((s, i) => <div key={s} className={"wiz-dot" + (i + 1 === step ? " on" : "") + (i + 1 < step ? " done" : "")}><span>{i + 1 < step ? "✓" : i + 1}</span>{s}</div>)}
        </div>
      </div>
      <div className="wcard wiz-body">
        {step === 1 && (<>
          <h2>Was möchtest du erreichen?</h2>
          <div className="wgoals">
            {GOALS.map((g) => (
              <button key={g.v} className={"wgoal" + (form.goal === g.v ? " on" : "")} onClick={() => set({ goal: g.v, destination: g.v === "traffic" ? "website" : "lead_form" })}>
                <svg viewBox="0 0 24 24"><path d={g.icon} /></svg><div><b>{g.t}</b><span>{g.sub}</span></div>
              </button>
            ))}
          </div>
          {accounts.length > 1 && (<><label className="wlbl">Werbekonto</label>
            <select className="winp" value={form.adAccountId} onChange={(e) => set({ adAccountId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></>)}
          <label className="wlbl">Was bewirbst du? *</label>
          <input className="winp" placeholder="z. B. Photovoltaik-Anlagen, Badsanierung" value={form.offer} onChange={(e) => set({ offer: e.target.value })} />
          <label className="wlbl">Dein Vorteil (optional)</label>
          <input className="winp" placeholder="z. B. kostenlose Erstberatung" value={form.benefit} onChange={(e) => set({ benefit: e.target.value })} />
        </>)}

        {step === 2 && (<>
          <h2>Wen willst du erreichen?</h2>
          {audiences.length > 0 && (<>
            <label className="wlbl">Gespeicherte Zielgruppe übernehmen</label>
            <div className="wauds">
              {audiences.map((a) => <button key={a.id} className="waud" onClick={() => applyAudience(a)}>⭐ {a.name}<span>{a.summary}</span></button>)}
            </div>
          </>)}
          <label className="wlbl">Standort + Umkreis <span className="wlbl-fb">aus Facebook</span></label>
          {form.locations.length > 0 && (
            <div className="ad-chips">{form.locations.map((l) => (
              <span key={l.key} className="ad-chip">📍 {l.name}
                {l.type === "city" && <select className="ad-chip-radius" value={l.radiusKm ?? 30} onChange={(e) => set({ locations: form.locations.map((x) => x.key === l.key ? { ...x, radiusKm: Number(e.target.value) } : x) })}>{[10, 15, 20, 25, 30, 40, 50, 80].map((km) => <option key={km} value={km}>+{km}km</option>)}</select>}
                <button className="ad-chip-x" onClick={() => set({ locations: form.locations.filter((x) => x.key !== l.key) })}>×</button>
              </span>))}</div>
          )}
          <input className="winp" placeholder="Ort suchen (z. B. Klagenfurt) …" value={props.locQuery} onChange={(e) => props.setLocQuery(e.target.value)} />
          {props.locResults.length > 0 && <div className="ad-results">{props.locResults.map((r) => <div key={r.key} className="ad-result" onClick={() => addLocation(r)}><span>{r.name}</span><span className="ad-result-meta">{r.type === "city" ? "Stadt" : r.type === "region" ? "Region" : r.type}{r.region ? ` · ${r.region}` : ""}</span></div>)}</div>}
          {form.locations.length === 0 && <div className="ad-mini">Ohne Auswahl: ganz Österreich.</div>}
          <label className="wlbl">Ort/Region im Anzeigentext *</label>
          <input className="winp" placeholder="z. B. Klagenfurt" value={form.region} onChange={(e) => set({ region: e.target.value })} />
          <label className="wlbl">Interessen / Zielgruppe (optional) <span className="wlbl-fb">aus Facebook</span></label>
          {form.interests.length > 0 && <div className="ad-chips">{form.interests.map((i) => <span key={i.id} className="ad-chip">🎯 {i.name}<button className="ad-chip-x" onClick={() => set({ interests: form.interests.filter((x) => x.id !== i.id) })}>×</button></span>)}</div>}
          <input className="winp" placeholder="Interesse suchen (z. B. Photovoltaik, Eigenheim) …" value={props.intQuery} onChange={(e) => props.setIntQuery(e.target.value)} />
          {props.intResults.length > 0 && <div className="ad-results">{props.intResults.map((r) => <div key={r.id} className="ad-result" onClick={() => addInterest(r)}><span>{r.name}</span><span className="ad-result-meta">{r.audienceSize ? `${Math.round(r.audienceSize / 1000)}k` : ""}</span></div>)}</div>}
          <button className="wtune" onClick={() => props.setShowTune(!props.showTune)}>{props.showTune ? "− " : "+ "}Feintuning (Alter, Geschlecht)</button>
          {props.showTune && (
            <div className="ad-row2" style={{ marginTop: 8 }}>
              <div style={{ flex: 1 }}><label className="wlbl">Geschlecht</label>
                <select className="winp" value={form.gender} onChange={(e) => set({ gender: e.target.value })}><option value="">Alle</option><option value="men">Männer</option><option value="women">Frauen</option></select></div>
              <div style={{ flex: 1 }}><label className="wlbl">Alter</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}><input className="winp" type="number" min={18} max={65} value={form.ageMin} onChange={(e) => set({ ageMin: Number(e.target.value) })} /><span>–</span><input className="winp" type="number" min={18} max={65} value={form.ageMax} onChange={(e) => set({ ageMax: Number(e.target.value) })} /></div></div>
            </div>
          )}
        </>)}

        {step === 3 && (<>
          <h2>Budget & Kontaktweg</h2>
          <label className="wlbl">Tagesbudget</label>
          <div className="wbudgets">{BUDGETS.map((b) => <button key={b} className={"wbudget" + (form.budget === b ? " on" : "")} onClick={() => set({ budget: b })}>{b} €</button>)}</div>
          <label className="wlbl">Wie sollen Interessenten reagieren?</label>
          <div className="ad-toggle">
            <button className={"ad-toggle-b" + (form.destination === "lead_form" ? " on" : "")} onClick={() => set({ destination: "lead_form" })}>Formular ausfüllen</button>
            <button className={"ad-toggle-b" + (form.destination === "website" ? " on" : "")} onClick={() => set({ destination: "website" })}>Website besuchen</button>
          </div>
          {form.destination === "lead_form" && leadForms.length > 0 && (<>
            <label className="wlbl">Formular</label>
            <div className="wauds">
              <button className={"waud" + (!form.leadFormId ? " on" : "")} onClick={() => set({ leadFormId: "" })}>✨ Neues Formular<span>passend zur Anzeige erstellen</span></button>
              {leadForms.slice(0, 8).map((f) => (
                <button key={f.id} className={"waud" + (form.leadFormId === f.id ? " on" : "")} onClick={() => set({ leadFormId: f.id })}>📋 {f.name.length > 26 ? f.name.slice(0, 25) + "…" : f.name}<span>{f.leadsCount} Leads · {f.status === "ACTIVE" ? "aktiv" : "inaktiv"}</span></button>
              ))}
            </div>
          </>)}
          {form.destination === "website" ? (<><label className="wlbl">Website-Link *</label><input className="winp" placeholder="https://…" value={form.websiteUrl} onChange={(e) => set({ websiteUrl: e.target.value })} /></>)
            : (<><label className="wlbl">Datenschutz-Link * <span className="ad-mini" style={{ display: "inline" }}>(für das Formular nötig)</span></label><input className="winp" placeholder="https://deine-website.at/datenschutz" value={form.privacyUrl} onChange={(e) => set({ privacyUrl: e.target.value })} /></>)}
          <label className="wlbl">Anrede im Text</label>
          <div className="ad-toggle"><button className={"ad-toggle-b" + (form.tone === "du" ? " on" : "")} onClick={() => set({ tone: "du" })}>Du (nahbar)</button><button className={"ad-toggle-b" + (form.tone === "sie" ? " on" : "")} onClick={() => set({ tone: "sie" })}>Sie (seriös)</button></div>
        </>)}

        {step === 4 && (<>
          <h2>Text & schalten</h2>
          {!draft ? <div className="wmuted">{busy ? "✨ KI schreibt deinen Anzeigentext …" : "Wird vorbereitet …"}</div> : (<>
            <label className="wlbl">Überschrift</label>
            <input className="winp" value={draft.headline || ""} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
            <label className="wlbl">Anzeigentext</label>
            <textarea className="winp" rows={7} value={draft.primaryText || ""} onChange={(e) => setDraft({ ...draft, primaryText: e.target.value })} />
            {draft.creativeNote && <div className="ad-note"><b>🎬 Video-Idee:</b> {draft.creativeNote}</div>}
            {draft.questions.length > 0 && <div className="ad-note"><b>📋 Formular:</b> {draft.questions.join(" · ")}</div>}
            <div className="ad-note"><b>🎯 Zielgruppe:</b> {draft.locations.length ? draft.locations.map((l) => l.name + (l.radiusKm ? ` +${l.radiusKm}km` : "")).join(", ") : "ganz Österreich"} · {draft.ageMin}–{draft.ageMax} J.{draft.interests.length ? " · " + draft.interests.map((i) => i.name).join(", ") : ""}</div>
            <label className="wlbl">Video (empfohlen – deine Anzeigen sind meist Videos)</label>
            <label className={"wupload" + (videoBusy ? " busy" : "") + (draft.videoId ? " done" : "")}>
              {videoBusy ? "⏳ Lädt hoch & überträgt zu Meta …" : draft.videoId ? "🎬 Video angehängt ✓ – anderes wählen" : "📹 Video hochladen"}
              <input type="file" accept="video/*" hidden disabled={videoBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVideo(f); e.target.value = ""; }} />
            </label>
            <label className="wlbl">Bild-URL (optional, falls kein Video)</label>
            <input className="winp" placeholder="https://…" value={draft.imageUrl || ""} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
            <div className="addrow"><button className="wbtn ghost" disabled={busy} onClick={() => regen("ki")} style={{ flex: 1 }}>✨ Neu mit KI</button><button className="wbtn ghost" disabled={busy} onClick={() => regen("vorlage")} style={{ flex: 1 }}>↻ Vorlage</button></div>
            {draft.status === "launch_error" && draft.launchError && <div className="ad-err" style={{ marginTop: 10 }}>Meta meldet: {draft.launchError}</div>}
            {draft.status === "rejected" && draft.reviewComment && <div className="ad-err" style={{ marginTop: 10 }}>Abgelehnt: {draft.reviewComment}</div>}
            <div className="ad-hint" style={{ marginTop: 12 }}>{isCustomer ? "Dein Betreuer prüft die Anzeige und schaltet sie frei." : "Die Anzeige wird pausiert erstellt – die finale Freigabe machst du in Meta."}</div>
          </>)}
        </>)}
      </div>

      <div className="wiz-preview">
        <div className="wprev-label">Vorschau</div>
        {draft || step >= 3 ? (
          <div className="fbprev">
            <div className="fbprev-head">
              <div className="fbprev-av">{(pageName[0] || "E").toUpperCase()}</div>
              <div><div className="fbprev-name">{pageName}</div><div className="fbprev-sub">Gesponsert · 🌐</div></div>
            </div>
            {prevText && <div className="fbprev-text">{prevText}</div>}
            <div className="fbprev-media">{prevImage ? <img src={prevImage} alt="" /> : <span>{prevVideo ? "🎬" : "🖼"}</span>}{prevVideo && <span className="vbadge">▶</span>}</div>
            <div className="fbprev-foot">
              <div className="fbprev-foot-main">
                <div className="fbprev-domain">{prevDomain}</div>
                <div className="fbprev-headline">{prevHeadline}</div>
              </div>
              <button className="fbprev-cta">{prevCta}</button>
            </div>
          </div>
        ) : (
          <div className="wprev-hint">Hier siehst du deine fertige Anzeige – sobald Text & Bild stehen.</div>
        )}
      </div>

      <div className="wiz-foot">
        {step > 1 ? <button className="wbtn ghost" onClick={() => setStep(step - 1)} disabled={busy}>‹ Zurück</button> : <span />}
        {step < 4 ? (
          <button className="wbtn primary" disabled={!stepOk(step)} onClick={next}>Weiter ›</button>
        ) : isCustomer ? (
          <button className="wbtn primary" disabled={busy || !draft} onClick={submitForReview}>{busy ? "…" : "An Betreuer zur Freigabe senden"}</button>
        ) : (
          <button className="wbtn primary" disabled={busy || !draft} onClick={launch}>{busy ? "…" : "Pausiert an Meta senden"}</button>
        )}
      </div>
    </div>
  );
}
