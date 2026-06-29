"use client";

import { useEffect, useState } from "react";
import type { AdAccountDTO, AdDraftDTO, AdLocation, AdInterest } from "@/lib/types";
import type { OverviewTotals, OverviewCampaign, AdRow, LeadRow, SavedAudience, LeadFormRow } from "@/lib/meta";
import { supabaseBrowser } from "@/lib/supabase/client";

const json = { "Content-Type": "application/json" };
function eur(n: number, dec = 0): string {
  return n.toLocaleString("de-AT", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " €";
}
function num(n: number): string {
  return Math.round(n).toLocaleString("de-AT");
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const GOALS: { v: string; t: string; sub: string; icon: string }[] = [
  { v: "leads", t: "Anfragen / Leads", sub: "Kontaktdaten sammeln", icon: "M3 7l9 6 9-6M3 5h18v14H3z" },
  { v: "appointments", t: "Termine", sub: "Terminanfragen", icon: "M3 4h18v17H3zM3 9h18M8 2v4M16 2v4" },
  { v: "jobs", t: "Mitarbeiter", sub: "Bewerbungen", icon: "M9 8a3 3 0 1 0 0-.01M3.5 19a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6" },
  { v: "traffic", t: "Website-Besuche", sub: "Mehr Besucher", icon: "M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" },
];
const BUDGETS = [10, 20, 30, 50, 100];
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

type Range = "7" | "30" | "90" | "custom";

export default function Werbung() {
  const [accounts, setAccounts] = useState<AdAccountDTO[]>([]);
  const [drafts, setDrafts] = useState<AdDraftDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [selId, setSelId] = useState("");
  const [range, setRange] = useState<Range>("30");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [tab, setTab] = useState<"overview" | "ads" | "leads">("overview");

  const [totals, setTotals] = useState<OverviewTotals | null>(null);
  const [campaigns, setCampaigns] = useState<OverviewCampaign[]>([]);
  const [ads, setAds] = useState<AdRow[]>([]);
  const [leads, setLeads] = useState<{ leads: LeadRow[]; totalForms: number; forms?: { name: string; count: number }[]; note?: string } | null>(null);
  const [audiences, setAudiences] = useState<SavedAudience[]>([]);
  const [leadForms, setLeadForms] = useState<LeadFormRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

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
  function period(): { since: string; until: string } {
    if (range === "custom" && customSince && customUntil) return { since: customSince, until: customUntil };
    const days = range === "7" ? 7 : range === "90" ? 90 : 30;
    const until = new Date();
    const since = new Date(until.getTime() - (days - 1) * 86400000);
    return { since: ymd(since), until: ymd(until) };
  }

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
  useEffect(() => { loadAccounts(); }, []);

  // Kennzahlen + aktuellen Tab laden, wenn Konto/Zeitraum/Filter wechseln
  useEffect(() => {
    if (!selId) return;
    const { since, until } = period();
    const a = activeOnly ? "&active=1" : "";
    setDataLoading(true);
    fetch(`/api/ads/overview?accountId=${selId}&since=${since}&until=${until}${a}`)
      .then((r) => r.json())
      .then((d) => { setTotals(d.totals || null); setCampaigns(d.campaigns || []); })
      .catch(() => {})
      .finally(() => setDataLoading(false));
    setAds([]); setLeads(null);
    fetch(`/api/ads/audiences?accountId=${selId}`).then((r) => r.json()).then((d) => setAudiences(d.audiences || [])).catch(() => {});
    fetch(`/api/ads/forms?accountId=${selId}`).then((r) => r.json()).then((d) => setLeadForms(d.forms || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, range, customSince, customUntil, activeOnly]);

  useEffect(() => {
    if (!selId) return;
    const { since, until } = period();
    const a = activeOnly ? "&active=1" : "";
    if (tab === "ads" && ads.length === 0) {
      fetch(`/api/ads/list?accountId=${selId}&since=${since}&until=${until}${a}`).then((r) => r.json()).then((d) => setAds(d.ads || [])).catch(() => {});
    }
    if (tab === "leads" && !leads) {
      fetch(`/api/ads/leads?accountId=${selId}`).then((r) => r.json()).then((d) => setLeads(d)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selId]);

  async function sync() {
    setSyncing(true);
    try {
      await fetch("/api/ads/sync", { method: "POST", headers: json, body: JSON.stringify({ accountId: selId }) });
      setRange((r) => r); setSelId((s) => s); // Re-Trigger
      const { since, until } = period();
      const a = activeOnly ? "&active=1" : "";
      const d = await (await fetch(`/api/ads/overview?accountId=${selId}&since=${since}&until=${until}${a}`)).json();
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
        {NAV.map((n) => (
          <a key={n.label} href={n.href} className={"wnav-i" + (n.label === "Werbung" ? " active" : "")}>
            <svg viewBox="0 0 24 24"><path d={n.icon} /></svg>{n.label}
          </a>
        ))}
      </aside>

      <main className="wmain">
        {toast && <div className="wtoast">{toast}</div>}

        {mode === "wizard" ? (
          <Wizard
            form={form} setForm={setForm} step={step} setStep={setStep} exitWizard={exitWizard}
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
                    <div className="wchips">
                      {([["7", "7 Tage"], ["30", "30 Tage"], ["90", "90 Tage"], ["custom", "Eigener"]] as [Range, string][]).map(([v, l]) => (
                        <button key={v} className={"wchip" + (range === v ? " on" : "")} onClick={() => setRange(v)}>{l}</button>
                      ))}
                    </div>
                    <button className={"wchip toggle" + (activeOnly ? " on" : "")} onClick={() => setActiveOnly(!activeOnly)}>● Nur aktive</button>
                  </div>
                  {range === "custom" && (
                    <div className="wdates">
                      <input type="date" value={customSince} onChange={(e) => setCustomSince(e.target.value)} />
                      <span>bis</span>
                      <input type="date" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} />
                    </div>
                  )}
                </div>

                {sel?.status === "error" && <div className="ad-err">Verbindung fehlt: {sel.lastError || "Token abgelaufen"}. Neu verbinden über <a href="/connect">/connect</a>.</div>}

                <div className="wkpis">
                  <Kpi v={totals ? eur(totals.spend) : "–"} l="Ausgaben" big />
                  <Kpi v={totals ? num(totals.leads) : "–"} l="Leads" big />
                  <Kpi v={totals?.cpl != null ? eur(totals.cpl) : "–"} l="Kosten / Lead" />
                  <Kpi v={totals?.ctr != null ? totals.ctr.toFixed(1) + "%" : "–"} l="CTR" />
                  <Kpi v={totals ? num(totals.reach) : "–"} l="Reichweite" />
                  <Kpi v={totals ? num(totals.impressions) : "–"} l="Impressionen" />
                </div>

                <div className="wtabs">
                  {([["overview", "Übersicht"], ["ads", "Anzeigen"], ["leads", "Leads"]] as ["overview" | "ads" | "leads", string][]).map(([v, l]) => (
                    <button key={v} className={"wtab" + (tab === v ? " on" : "")} onClick={() => setTab(v)}>{l}</button>
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
                          <div><b>{c.ctr != null ? c.ctr.toFixed(1) + "%" : "–"}</b><span>CTR</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "ads" && (
                  ads.length === 0 ? <div className="wmuted">{dataLoading ? "Lade Anzeigen …" : activeOnly ? "Keine aktiven Anzeigen." : "Keine Anzeigen im Zeitraum."}</div> :
                  <div className="wads">
                    {ads.map((ad) => (
                      <div key={ad.id} className="wad">
                        <div className="wad-thumb">{ad.thumbnailUrl ? <img src={ad.thumbnailUrl} alt="" /> : <span>{ad.objectType === "VIDEO" ? "▶" : "▦"}</span>}</div>
                        <div className="wad-main">
                          <div className="wad-name">{ad.name}</div>
                          <div className="wad-sub">{ad.campaign || ""} · {ad.effectiveStatus === "ACTIVE" ? "aktiv" : "pausiert"}{ad.objectType === "VIDEO" ? " · Video" : ""}</div>
                          <div className="wad-metrics"><span><b>{eur(ad.spend)}</b></span><span><b>{ad.leads}</b> Leads</span><span><b>{ad.cpl != null ? eur(ad.cpl) : "–"}</b>/L</span><span><b>{ad.ctr != null ? ad.ctr.toFixed(1) + "%" : "–"}</b></span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "leads" && (
                  <>
                    <div className="wlead-sum">{totals ? num(totals.leads) : "0"} Leads im Zeitraum{totals?.cpl != null ? ` · ${eur(totals.cpl)} pro Lead` : ""}</div>
                    {!leads ? <div className="wmuted">Lade Leads …</div> : (
                      <>
                        {leads.leads.length > 0 ? (
                          <div className="wleads">
                            {leads.leads.map((l) => (
                              <div key={l.id} className="wlead">
                                <div className="wlead-main"><b>{l.name || "(ohne Namen)"}</b>{l.phone ? " · " + l.phone : ""}{l.email ? " · " + l.email : ""}</div>
                                <div className="wlead-meta">{l.createdTime?.slice(0, 10)} · {l.form}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            {leads.forms && leads.forms.length > 0 && (
                              <div className="wleads">
                                {leads.forms.map((f, i) => (
                                  <div key={i} className="wlead">
                                    <div className="wlead-main"><b>{f.count}</b> Leads</div>
                                    <div className="wlead-meta">{f.name}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {leads.note && <div className="ad-note" style={{ marginTop: 10 }}>ℹ️ {leads.note}</div>}
                          </>
                        )}
                      </>
                    )}
                  </>
                )}

                {drafts.filter((d) => d.status !== "launched").length > 0 && (
                  <div className="wcard" style={{ marginTop: 16 }}>
                    <div className="wrecs-t">Entwürfe</div>
                    {drafts.filter((d) => d.status !== "launched").map((d) => (
                      <div key={d.id} className="wdraft" onClick={() => { setForm({ ...emptyForm, adAccountId: d.adAccountId, goal: d.goal, offer: d.offer, region: d.region, tone: d.tone, budget: d.budget, destination: d.destination, privacyUrl: d.privacyUrl || "", websiteUrl: d.websiteUrl || "", imageUrl: d.imageUrl || "", locations: d.locations, interests: d.interests, gender: d.gender || "", ageMin: d.ageMin, ageMax: d.ageMax, benefit: d.benefit || "" }); setDraft(d); setStep(4); setMode("wizard"); }}>
                        <span>{d.offer}</span><span className={"pill " + (d.status === "launch_error" ? "p-none" : "p-acct")}>{d.status === "launch_error" ? "Fehler" : "Entwurf"}</span>
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

function Kpi({ v, l, big }: { v: string; l: string; big?: boolean }) {
  return (
    <div className={"wkpi" + (big ? " big" : "")}>
      <div className="wkpi-v">{v}</div>
      <div className="wkpi-l">{l}</div>
    </div>
  );
}

// ── Wizard ──────────────────────────────────────────────────────────────
function Wizard(props: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void; step: number; setStep: (s: number) => void; exitWizard: () => void;
  accounts: AdAccountDTO[]; draft: AdDraftDTO | null; setDraft: (d: AdDraftDTO | null) => void; busy: boolean; setBusy: (b: boolean) => void; flash: (t: string) => void;
  showTune: boolean; setShowTune: (b: boolean) => void; audiences: SavedAudience[]; leadForms: LeadFormRow[];
  locQuery: string; setLocQuery: (s: string) => void; locResults: { key: string; name: string; type: string; region?: string; country?: string }[]; setLocResults: (r: never[]) => void;
  intQuery: string; setIntQuery: (s: string) => void; intResults: { id: string; name: string; audienceSize?: number; path?: string }[]; setIntResults: (r: never[]) => void;
}) {
  const { form, setForm, step, setStep, exitWizard, accounts, draft, setDraft, busy, setBusy, flash, audiences, leadForms } = props;
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
            <div className="ad-hint" style={{ marginTop: 12 }}>Die Anzeige wird <b>pausiert</b> erstellt – die finale Freigabe machst du in Meta.</div>
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
        {step < 4 ? <button className="wbtn primary" disabled={!stepOk(step)} onClick={next}>Weiter ›</button> : <button className="wbtn primary" disabled={busy || !draft} onClick={launch}>{busy ? "…" : "Pausiert an Meta senden"}</button>}
      </div>
    </div>
  );
}
