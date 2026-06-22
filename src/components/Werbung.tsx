"use client";

import { useEffect, useState } from "react";
import type { AdAccountDTO, AdCampaignDTO, AdDraftDTO, AdLocation, AdInterest } from "@/lib/types";

const json = { "Content-Type": "application/json" };
function eur(n: number): string {
  return Math.round(n).toLocaleString("de-AT") + " €";
}

const GOALS: { v: string; t: string; sub: string; icon: string }[] = [
  { v: "leads", t: "Anfragen / Leads", sub: "Kunden hinterlassen ihre Kontaktdaten", icon: "M3 7l9 6 9-6M3 5h18v14H3z" },
  { v: "appointments", t: "Termine", sub: "Direkt Terminanfragen sammeln", icon: "M3 4h18v17H3zM3 9h18M8 2v4M16 2v4" },
  { v: "jobs", t: "Mitarbeiter", sub: "Bewerbungen für offene Stellen", icon: "M9 8a3 3 0 1 0 0-.01M3.5 19a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6" },
  { v: "traffic", t: "Website-Besuche", sub: "Mehr Besucher auf deine Seite", icon: "M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" },
];
const BUDGETS = [10, 20, 30, 50, 100];

type Form = {
  adAccountId: string;
  goal: string;
  offer: string;
  benefit: string;
  region: string;
  locations: AdLocation[];
  interests: AdInterest[];
  gender: string;
  ageMin: number;
  ageMax: number;
  tone: string;
  budget: number;
  destination: string;
  privacyUrl: string;
  websiteUrl: string;
  imageUrl: string;
};
const emptyForm: Form = {
  adAccountId: "", goal: "leads", offer: "", benefit: "", region: "", locations: [], interests: [],
  gender: "", ageMin: 25, ageMax: 65, tone: "du", budget: 20, destination: "lead_form", privacyUrl: "", websiteUrl: "", imageUrl: "",
};

const NAV = [
  { label: "Posteingang", href: "/", icon: "M3 7l9 6 9-6M3 5h18v14H3z" },
  { label: "Kunden", href: "/?view=kunden", icon: "M9 8a3 3 0 1 0 0-.01M3.5 19a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6" },
  { label: "Kalender", href: "/?view=kalender", icon: "M3 4.5h18v16H3zM3 9h18M8 2.5v4M16 2.5v4" },
  { label: "Werbung", href: "/werbung", icon: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6" },
  { label: "Buchhaltung", href: "/buchhaltung", icon: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6" },
];

export default function Werbung() {
  const [accounts, setAccounts] = useState<AdAccountDTO[]>([]);
  const [campaigns, setCampaigns] = useState<AdCampaignDTO[]>([]);
  const [drafts, setDrafts] = useState<AdDraftDTO[]>([]);
  const [recs, setRecs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [mode, setMode] = useState<"dashboard" | "wizard">("dashboard");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>(emptyForm);
  const [draft, setDraft] = useState<AdDraftDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTune, setShowTune] = useState(false);
  // Facebook-Suche
  const [locQuery, setLocQuery] = useState("");
  const [locResults, setLocResults] = useState<{ key: string; name: string; type: string; region?: string; country?: string }[]>([]);
  const [intQuery, setIntQuery] = useState("");
  const [intResults, setIntResults] = useState<{ id: string; name: string; audienceSize?: number; path?: string }[]>([]);

  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/ads");
      const d = await r.json();
      setAccounts(d.accounts || []);
      setCampaigns(d.campaigns || []);
      setDrafts(d.drafts || []);
      setRecs(d.recommendations || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      await fetch("/api/ads/sync", { method: "POST", headers: json, body: "{}" });
      await load();
      flash("Zahlen frisch von Meta geladen.");
    } catch {
      flash("Aktualisieren fehlgeschlagen.");
    } finally {
      setSyncing(false);
    }
  }

  // FB-Suche (debounced)
  useEffect(() => {
    const q = locQuery.trim();
    if (q.length < 2) { setLocResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ads/targeting?kind=location&q=${encodeURIComponent(q)}&accountId=${form.adAccountId}`);
        const d = await r.json();
        setLocResults(d.results || []);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locQuery]);
  useEffect(() => {
    const q = intQuery.trim();
    if (q.length < 2) { setIntResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ads/targeting?kind=interest&q=${encodeURIComponent(q)}&accountId=${form.adAccountId}`);
        const d = await r.json();
        setIntResults(d.results || []);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intQuery]);

  function startWizard() {
    const first = accounts.find((a) => a.hasToken);
    setForm({ ...emptyForm, adAccountId: first?.id || "" });
    setDraft(null);
    setStep(1);
    setShowTune(false);
    setLocQuery(""); setLocResults([]); setIntQuery(""); setIntResults([]);
    setMode("wizard");
  }
  function exitWizard() {
    setMode("dashboard");
    setDraft(null);
    load();
  }

  function addLocation(r: { key: string; name: string; type: string }) {
    if (form.locations.some((l) => l.key === r.key)) return;
    setForm((f) => ({
      ...f,
      locations: [...f.locations, { type: r.type, key: r.key, name: r.name, radiusKm: r.type === "city" ? 30 : undefined }],
      region: f.region || r.name,
    }));
    setLocQuery(""); setLocResults([]);
  }
  function addInterest(r: { id: string; name: string }) {
    if (form.interests.some((i) => i.id === r.id)) return;
    setForm((f) => ({ ...f, interests: [...f.interests, { id: r.id, name: r.name }] }));
    setIntQuery(""); setIntResults([]);
  }

  // Schritt-Validierung
  const stepOk = (s: number): boolean => {
    if (s === 1) return !!form.adAccountId && form.offer.trim().length > 1;
    if (s === 2) return form.region.trim().length > 1 || form.locations.length > 0;
    if (s === 3) return form.destination === "website" ? /^https?:\/\//i.test(form.websiteUrl) : /^https?:\/\//i.test(form.privacyUrl);
    return true;
  };

  async function generateDraft(mode: "ki" | "vorlage" = "ki") {
    setBusy(true);
    try {
      const r = await fetch("/api/ads/draft", { method: "POST", headers: json, body: JSON.stringify({ ...form, mode }) });
      const d = await r.json();
      if (r.ok) setDraft(d);
      else flash(d.error || "Entwurf fehlgeschlagen");
    } catch {
      flash("Entwurf fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function regen(mode: "ki" | "vorlage") {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/ads/draft/${draft.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ regenerate: mode, tone: form.tone }) });
      const d = await r.json();
      if (r.ok) setDraft(d);
    } finally {
      setBusy(false);
    }
  }

  async function gotoStep(s: number) {
    // Beim Wechsel auf Schritt 4: Entwurf erzeugen, falls noch keiner da ist.
    if (s === 4 && !draft) {
      setStep(4);
      await generateDraft("ki");
      return;
    }
    setStep(s);
  }

  async function launch() {
    if (!draft) return;
    setBusy(true);
    try {
      await fetch(`/api/ads/draft/${draft.id}`, {
        method: "PATCH", headers: json,
        body: JSON.stringify({ headline: draft.headline, primaryText: draft.primaryText, imageUrl: draft.imageUrl }),
      }).catch(() => {});
      const r = await fetch(`/api/ads/draft/${draft.id}/launch`, { method: "POST", headers: json });
      const d = await r.json();
      if (d.ok) {
        flash("✅ Anzeige pausiert in Meta erstellt – dort final freigeben.");
        exitWizard();
      } else {
        setDraft({ ...draft, status: "launch_error", launchError: d.error || "Launch fehlgeschlagen" });
        flash("Meta meldet: " + (d.error || "Launch fehlgeschlagen"));
      }
    } catch {
      flash("Launch fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const connected = accounts.filter((a) => a.hasToken);

  return (
    <div className="wpage">
      <aside className="wnav">
        <div className="wnav-brand">ePower Cockpit</div>
        {NAV.map((n) => (
          <a key={n.label} href={n.href} className={"wnav-i" + (n.label === "Werbung" ? " active" : "")}>
            <svg viewBox="0 0 24 24"><path d={n.icon} /></svg>
            {n.label}
          </a>
        ))}
      </aside>

      <main className="wmain">
        {toast && <div className="wtoast">{toast}</div>}

        {mode === "dashboard" ? (
          <>
            <div className="whead">
              <div>
                <h1>Werbeanzeigen</h1>
                <p>Was läuft, wie gut – und neue Anzeigen in wenigen Schritten.</p>
              </div>
              <div className="whead-actions">
                <button className="wbtn ghost" disabled={syncing} onClick={sync}>{syncing ? "…" : "↻ Aktualisieren"}</button>
                <button className="wbtn primary" onClick={startWizard} disabled={!connected.length}>+ Neue Anzeige</button>
              </div>
            </div>

            {loading ? (
              <div className="wmuted">Lade Werbedaten …</div>
            ) : accounts.length === 0 ? (
              <div className="wmuted">Noch kein Werbekonto verbunden. Verbinde es unter <a href="/connect">/connect</a>.</div>
            ) : (
              <>
                {recs.length > 0 && (
                  <div className="wcard wrecs">
                    <div className="wrecs-t">💡 Empfehlungen</div>
                    {recs.map((t) => <div key={t} className="wrec">{t}</div>)}
                  </div>
                )}
                {accounts.map((acc) => {
                  const camps = campaigns.filter((c) => c.adAccountId === acc.id);
                  return (
                    <div key={acc.id} className="wsection">
                      <div className="wsec-head">
                        <strong>{acc.label}</strong>
                        <span className={"pill " + (acc.status === "connected" ? "pill-firma" : "p-none")}>
                          {acc.status === "connected" ? "verbunden" : acc.status === "error" ? "Token prüfen" : "nicht verbunden"}
                        </span>
                      </div>
                      {acc.status === "error" && <div className="ad-err">Verbindung fehlt: {acc.lastError || "Token abgelaufen"}. Neu verbinden über <a href="/connect">/connect</a>.</div>}
                      {camps.length === 0 ? (
                        <div className="wmuted small">Noch keine Kampagnen.</div>
                      ) : (
                        <div className="wgrid">
                          {camps.map((c) => (
                            <div key={c.id} className="wcamp">
                              <div className="wcamp-top">
                                <span className={"ampel ad-" + c.health.state} title={c.health.reason}>{c.health.label}</span>
                                <span className="wcamp-name">{c.name}</span>
                              </div>
                              <div className="wcamp-metrics">
                                <div><b>{eur(c.spend)}</b><span>Ausgaben</span></div>
                                <div><b>{c.leads}</b><span>Leads</span></div>
                                <div><b>{c.cpa != null ? eur(c.cpa) : "–"}</b><span>/Lead</span></div>
                                <div><b>{c.ctr != null ? c.ctr.toFixed(1) + "%" : "–"}</b><span>CTR</span></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {drafts.filter((d) => d.status !== "launched").length > 0 && (
                  <div className="wcard">
                    <div className="wrecs-t">Entwürfe</div>
                    {drafts.filter((d) => d.status !== "launched").map((d) => (
                      <div key={d.id} className="wdraft" onClick={() => { setForm({ ...emptyForm, adAccountId: d.adAccountId, goal: d.goal, offer: d.offer, region: d.region, tone: d.tone, budget: d.budget, destination: d.destination, privacyUrl: d.privacyUrl || "", websiteUrl: d.websiteUrl || "", imageUrl: d.imageUrl || "", locations: d.locations, interests: d.interests, gender: d.gender || "", ageMin: d.ageMin, ageMax: d.ageMax, benefit: d.benefit || "" }); setDraft(d); setStep(4); setMode("wizard"); }}>
                        <span>{d.offer}</span>
                        <span className={"pill " + (d.status === "launch_error" ? "p-none" : "p-acct")}>{d.status === "launch_error" ? "Fehler" : "Entwurf"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <Wizard
            form={form} setForm={setForm} step={step} gotoStep={gotoStep} setStep={setStep}
            stepOk={stepOk} accounts={connected} exitWizard={exitWizard}
            draft={draft} setDraft={setDraft} busy={busy} launch={launch} regen={regen}
            showTune={showTune} setShowTune={setShowTune}
            locQuery={locQuery} setLocQuery={setLocQuery} locResults={locResults} addLocation={addLocation}
            intQuery={intQuery} setIntQuery={setIntQuery} intResults={intResults} addInterest={addInterest}
          />
        )}
      </main>
    </div>
  );
}

// ── Wizard ────────────────────────────────────────────────────────────────
function Wizard(props: {
  form: Form; setForm: (f: Form | ((p: Form) => Form)) => void; step: number; gotoStep: (s: number) => void; setStep: (s: number) => void;
  stepOk: (s: number) => boolean; accounts: AdAccountDTO[]; exitWizard: () => void;
  draft: AdDraftDTO | null; setDraft: (d: AdDraftDTO | null) => void; busy: boolean; launch: () => void; regen: (m: "ki" | "vorlage") => void;
  showTune: boolean; setShowTune: (b: boolean) => void;
  locQuery: string; setLocQuery: (s: string) => void; locResults: { key: string; name: string; type: string; region?: string; country?: string }[]; addLocation: (r: { key: string; name: string; type: string }) => void;
  intQuery: string; setIntQuery: (s: string) => void; intResults: { id: string; name: string; audienceSize?: number; path?: string }[]; addInterest: (r: { id: string; name: string }) => void;
}) {
  const { form, setForm, step, gotoStep, setStep, stepOk, accounts, exitWizard, draft, setDraft, busy, launch, regen } = props;
  const STEPS = ["Ziel", "Zielgruppe", "Budget", "Text & schalten"];
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="wiz">
      <div className="wiz-head">
        <button className="wlink" onClick={exitWizard}>‹ Zurück zur Übersicht</button>
        <div className="wiz-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={"wiz-dot" + (i + 1 === step ? " on" : "") + (i + 1 < step ? " done" : "")}>
              <span>{i + 1 < step ? "✓" : i + 1}</span>{s}
            </div>
          ))}
        </div>
      </div>

      <div className="wcard wiz-body">
        {step === 1 && (
          <>
            <h2>Was möchtest du erreichen?</h2>
            <div className="wgoals">
              {GOALS.map((g) => (
                <button key={g.v} className={"wgoal" + (form.goal === g.v ? " on" : "")} onClick={() => set({ goal: g.v, destination: g.v === "traffic" ? "website" : "lead_form" })}>
                  <svg viewBox="0 0 24 24"><path d={g.icon} /></svg>
                  <div><b>{g.t}</b><span>{g.sub}</span></div>
                </button>
              ))}
            </div>
            {accounts.length > 1 && (
              <>
                <label className="wlbl">Werbekonto</label>
                <select className="winp" value={form.adAccountId} onChange={(e) => set({ adAccountId: e.target.value })}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </>
            )}
            <label className="wlbl">Was bewirbst du? *</label>
            <input className="winp" placeholder="z. B. Photovoltaik-Anlagen, Badsanierung, Dachcheck" value={form.offer} onChange={(e) => set({ offer: e.target.value })} />
            <label className="wlbl">Dein Vorteil (optional)</label>
            <input className="winp" placeholder="z. B. kostenlose Erstberatung, 20 Jahre Erfahrung" value={form.benefit} onChange={(e) => set({ benefit: e.target.value })} />
          </>
        )}

        {step === 2 && (
          <>
            <h2>Wen willst du erreichen?</h2>
            <label className="wlbl">Standort + Umkreis <span className="wlbl-fb">aus Facebook</span></label>
            {form.locations.length > 0 && (
              <div className="ad-chips">
                {form.locations.map((l) => (
                  <span key={l.key} className="ad-chip">
                    📍 {l.name}
                    {l.type === "city" && (
                      <select className="ad-chip-radius" value={l.radiusKm ?? 30} onChange={(e) => set({ locations: form.locations.map((x) => (x.key === l.key ? { ...x, radiusKm: Number(e.target.value) } : x)) })}>
                        {[10, 15, 20, 25, 30, 40, 50, 80].map((km) => <option key={km} value={km}>+{km} km</option>)}
                      </select>
                    )}
                    <button className="ad-chip-x" onClick={() => set({ locations: form.locations.filter((x) => x.key !== l.key) })}>×</button>
                  </span>
                ))}
              </div>
            )}
            <input className="winp" placeholder="Ort suchen (z. B. Klagenfurt) …" value={props.locQuery} onChange={(e) => props.setLocQuery(e.target.value)} />
            {props.locResults.length > 0 && (
              <div className="ad-results">
                {props.locResults.map((r) => (
                  <div key={r.key} className="ad-result" onClick={() => props.addLocation(r)}>
                    <span>{r.name}</span>
                    <span className="ad-result-meta">{r.type === "city" ? "Stadt" : r.type === "region" ? "Region" : r.type}{r.region ? ` · ${r.region}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
            {form.locations.length === 0 && <div className="ad-mini">Ohne Auswahl: ganz Österreich.</div>}

            <label className="wlbl">Ort/Region im Anzeigentext *</label>
            <input className="winp" placeholder="z. B. Klagenfurt" value={form.region} onChange={(e) => set({ region: e.target.value })} />
            <div className="ad-mini">Wird in der Anzeige für die lokale Ansprache genutzt („An alle in …").</div>

            <label className="wlbl">Interessen / Zielgruppe (optional) <span className="wlbl-fb">aus Facebook</span></label>
            {form.interests.length > 0 && (
              <div className="ad-chips">
                {form.interests.map((i) => (
                  <span key={i.id} className="ad-chip">🎯 {i.name}<button className="ad-chip-x" onClick={() => set({ interests: form.interests.filter((x) => x.id !== i.id) })}>×</button></span>
                ))}
              </div>
            )}
            <input className="winp" placeholder="Interesse suchen (z. B. Photovoltaik, Eigenheim) …" value={props.intQuery} onChange={(e) => props.setIntQuery(e.target.value)} />
            {props.intResults.length > 0 && (
              <div className="ad-results">
                {props.intResults.map((r) => (
                  <div key={r.id} className="ad-result" onClick={() => props.addInterest(r)}>
                    <span>{r.name}</span>
                    <span className="ad-result-meta">{r.audienceSize ? `${Math.round(r.audienceSize / 1000)}k` : ""}</span>
                  </div>
                ))}
              </div>
            )}

            <button className="wtune" onClick={() => props.setShowTune(!props.showTune)}>{props.showTune ? "− " : "+ "}Feintuning (Alter, Geschlecht)</button>
            {props.showTune && (
              <div className="ad-row2" style={{ marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <label className="wlbl">Geschlecht</label>
                  <select className="winp" value={form.gender} onChange={(e) => set({ gender: e.target.value })}>
                    <option value="">Alle</option><option value="men">Männer</option><option value="women">Frauen</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="wlbl">Alter</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input className="winp" type="number" min={18} max={65} value={form.ageMin} onChange={(e) => set({ ageMin: Number(e.target.value) })} />
                    <span>–</span>
                    <input className="winp" type="number" min={18} max={65} value={form.ageMax} onChange={(e) => set({ ageMax: Number(e.target.value) })} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2>Budget & Kontaktweg</h2>
            <label className="wlbl">Tagesbudget</label>
            <div className="wbudgets">
              {BUDGETS.map((b) => (
                <button key={b} className={"wbudget" + (form.budget === b ? " on" : "")} onClick={() => set({ budget: b })}>{b} €</button>
              ))}
            </div>
            <label className="wlbl">Wie sollen Interessenten reagieren?</label>
            <div className="ad-toggle">
              <button className={"ad-toggle-b" + (form.destination === "lead_form" ? " on" : "")} onClick={() => set({ destination: "lead_form" })}>Formular ausfüllen</button>
              <button className={"ad-toggle-b" + (form.destination === "website" ? " on" : "")} onClick={() => set({ destination: "website" })}>Website besuchen</button>
            </div>
            {form.destination === "website" ? (
              <>
                <label className="wlbl">Website-Link *</label>
                <input className="winp" placeholder="https://…" value={form.websiteUrl} onChange={(e) => set({ websiteUrl: e.target.value })} />
              </>
            ) : (
              <>
                <label className="wlbl">Datenschutz-Link * <span className="ad-mini" style={{ display: "inline" }}>(für das Formular nötig)</span></label>
                <input className="winp" placeholder="https://deine-website.at/datenschutz" value={form.privacyUrl} onChange={(e) => set({ privacyUrl: e.target.value })} />
              </>
            )}
            <label className="wlbl">Anrede im Text</label>
            <div className="ad-toggle">
              <button className={"ad-toggle-b" + (form.tone === "du" ? " on" : "")} onClick={() => set({ tone: "du" })}>Du (nahbar)</button>
              <button className={"ad-toggle-b" + (form.tone === "sie" ? " on" : "")} onClick={() => set({ tone: "sie" })}>Sie (seriös)</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2>Text & schalten</h2>
            {!draft ? (
              <div className="wmuted">{busy ? "✨ KI schreibt deinen Anzeigentext …" : "Wird vorbereitet …"}</div>
            ) : (
              <>
                <label className="wlbl">Überschrift</label>
                <input className="winp" value={draft.headline || ""} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
                <label className="wlbl">Anzeigentext</label>
                <textarea className="winp" rows={7} value={draft.primaryText || ""} onChange={(e) => setDraft({ ...draft, primaryText: e.target.value })} />
                {draft.creativeNote && <div className="ad-note"><b>🎬 Video-Idee:</b> {draft.creativeNote}</div>}
                {draft.questions.length > 0 && <div className="ad-note"><b>📋 Formular:</b> {draft.questions.join(" · ")}</div>}
                <div className="ad-note"><b>🎯 Zielgruppe:</b>{" "}
                  {draft.locations.length ? draft.locations.map((l) => l.name + (l.radiusKm ? ` +${l.radiusKm}km` : "")).join(", ") : "ganz Österreich"}
                  {" · "}{draft.ageMin}–{draft.ageMax} J.{draft.interests.length ? " · " + draft.interests.map((i) => i.name).join(", ") : ""}
                </div>
                <label className="wlbl">Bild-URL (optional)</label>
                <input className="winp" placeholder="https://…" value={draft.imageUrl || ""} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
                <div className="addrow">
                  <button className="wbtn ghost" disabled={busy} onClick={() => regen("ki")} style={{ flex: 1 }}>✨ Neu mit KI</button>
                  <button className="wbtn ghost" disabled={busy} onClick={() => regen("vorlage")} style={{ flex: 1 }}>↻ Vorlage</button>
                </div>
                {draft.status === "launch_error" && draft.launchError && <div className="ad-err" style={{ marginTop: 10 }}>Meta meldet: {draft.launchError}</div>}
                <div className="ad-hint" style={{ marginTop: 12 }}>Die Anzeige wird <b>pausiert</b> erstellt – die finale Freigabe machst du in Meta.</div>
              </>
            )}
          </>
        )}
      </div>

      <div className="wiz-foot">
        {step > 1 ? <button className="wbtn ghost" onClick={() => setStep(step - 1)} disabled={busy}>‹ Zurück</button> : <span />}
        {step < 4 ? (
          <button className="wbtn primary" disabled={!stepOk(step)} onClick={() => gotoStep(step + 1)}>Weiter ›</button>
        ) : (
          <button className="wbtn primary" disabled={busy || !draft} onClick={launch}>{busy ? "…" : "Pausiert an Meta senden"}</button>
        )}
      </div>
    </div>
  );
}
