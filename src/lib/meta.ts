/**
 * Meta (Facebook) Marketing Graph API – reine fetch-Portierung der erprobten Ads-App-Logik.
 *
 * - Graph-Version v25.0, access_token IMMER als Parameter (kein Bearer-Header).
 * - Launch erstellt Campaign → Ad Set → Creative → Ad, ALLES status=PAUSED (nie sofort live).
 * - Sync zieht Kampagnen + Insights (letzte 30 Tage), Ampel-Bewertung wie in der Ads-App.
 *
 * Tokens kommen verschlüsselt aus AdAccount.tokenCipher (siehe adsCrypto.ts).
 */
import type { AdAccount, AdDraft } from "@prisma/client";
import { prisma } from "./db";
import { decryptToken } from "./adsCrypto";

const META_VERSION = "v25.0";
const graphUrl = (path: string) => `https://graph.facebook.com/${META_VERSION}/${path.replace(/^\//, "")}`;

// ── HTTP-Helfer ───────────────────────────────────────────────────────────
function formatGraphError(data: unknown, fallback: string): string {
  const err = (data as { error?: Record<string, string> })?.error;
  if (err) {
    const parts = [err.error_user_title, err.error_user_msg, err.message].filter((p) => p && p.trim());
    if (parts.length) return parts.join(" · ");
  }
  return fallback;
}

async function graphGet(path: string, token: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${graphUrl(path)}?${qs.toString()}`, { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatGraphError(data, `Meta API Fehler (${res.status})`));
  return data as Record<string, unknown>;
}

async function graphPost(path: string, token: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const form = new URLSearchParams({ ...body, access_token: token });
  const res = await fetch(graphUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatGraphError(data, `Meta API Fehler (${res.status})`));
  return data as Record<string, unknown>;
}

async function graphDelete(path: string, token: string): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ access_token: token });
  const res = await fetch(`${graphUrl(path)}?${qs.toString()}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatGraphError(data, `Meta API Fehler (${res.status})`));
  return data as Record<string, unknown>;
}

async function accountToken(acc: AdAccount): Promise<string> {
  if (!acc.tokenCipher) throw new Error("Kein Token hinterlegt – Konto erneut verbinden.");
  return decryptToken(acc.tokenCipher);
}

/** Löscht eine Meta-Kampagne (komplett mit Ad Set/Creative/Ad). */
export async function deleteCampaign(adAccountId: string, metaCampaignId: string): Promise<void> {
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  await graphDelete(metaCampaignId, token);
}

// ── Verbindung testen ─────────────────────────────────────────────────────
export interface MetaAccountInfo {
  id: string;
  name?: string;
  currency?: string;
  timezone?: string;
}

/** Prüft Token + Konto und liefert die Stammdaten (Name/Währung/Zeitzone). Wirft bei Fehler. */
export async function testConnection(token: string, metaAccountId: string): Promise<MetaAccountInfo> {
  const d = await graphGet(metaAccountId, token, { fields: "name,currency,timezone_name,account_status" });
  return {
    id: String(d.id ?? metaAccountId),
    name: d.name as string | undefined,
    currency: d.currency as string | undefined,
    timezone: d.timezone_name as string | undefined,
  };
}

// ── Sync (Kampagnen + Insights letzte 30 Tage) ────────────────────────────
const LEAD_ACTION_TYPES = [
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
  "contact",
];

type Action = { action_type?: string; value?: string | number };

/** Maximum aller passenden actions[].value für die gegebenen action_types. */
function actionValue(actions: Action[] | undefined, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  let max = 0;
  for (const a of actions) {
    if (a.action_type && types.includes(a.action_type)) {
      const v = Number(a.value ?? 0);
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  return max;
}

/** Holt Kampagnen-Metadaten + 30-Tage-Insights und schreibt sie in AdCampaign (Upsert). */
export async function syncCampaigns(adAccountId: string): Promise<{ count: number }> {
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const act = acc.metaAccountId;

  try {
    const campResp = await graphGet(`${act}/campaigns`, token, {
      fields: "id,name,objective,effective_status",
      limit: "200",
    });
    const insightsResp = await graphGet(`${act}/insights`, token, {
      level: "campaign",
      date_preset: "last_30d",
      fields: "campaign_id,spend,impressions,reach,clicks,ctr,frequency,actions",
      limit: "200",
    });

    const campaigns = (campResp.data as Record<string, unknown>[]) ?? [];
    const insights = (insightsResp.data as Record<string, unknown>[]) ?? [];
    const byCampaign = new Map<string, Record<string, unknown>>();
    for (const row of insights) byCampaign.set(String(row.campaign_id), row);

    for (const c of campaigns) {
      const id = String(c.id);
      const ins = byCampaign.get(id) ?? {};
      const spend = Number(ins.spend ?? 0) || 0;
      const impressions = Math.round(Number(ins.impressions ?? 0)) || 0;
      const reach = Math.round(Number(ins.reach ?? 0)) || 0;
      const clicks = Math.round(Number(ins.clicks ?? 0)) || 0;
      const ctr = ins.ctr != null && Number.isFinite(Number(ins.ctr)) ? Number(ins.ctr) : null;
      const frequency = ins.frequency != null && Number.isFinite(Number(ins.frequency)) ? Number(ins.frequency) : null;
      const actions = ins.actions as Action[] | undefined;
      const leads = Math.round(actionValue(actions, LEAD_ACTION_TYPES));
      const linkClicks = Math.round(actionValue(actions, ["link_click"]));
      const cpa = leads > 0 ? Math.round((spend / leads) * 100) / 100 : null;

      const dataRow = {
        adAccountId: acc.id,
        name: String(c.name ?? "(ohne Namen)"),
        objective: (c.objective as string) ?? null,
        effectiveStatus: (c.effective_status as string) ?? null,
        spend,
        impressions,
        reach,
        clicks,
        linkClicks,
        leads,
        cpa,
        ctr,
        frequency,
      };
      await prisma.adCampaign.upsert({
        where: { id },
        create: { id, ...dataRow },
        update: dataRow,
      });
    }

    await prisma.adAccount.update({
      where: { id: acc.id },
      data: { status: "connected", lastError: null, lastSyncAt: new Date() },
    });
    return { count: campaigns.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.adAccount.update({ where: { id: acc.id }, data: { status: "error", lastError: msg } });
    throw e;
  }
}

// ── Ampel-Bewertung (portiert aus campaign_score) ─────────────────────────
const CTR_STRONG = 2.8;
const CTR_OK = 1.5;
const MIN_DECISION_SPEND = 20;
const NO_RESULT_SPEND = 40;
const CPA_STRONG = 25;
const CPA_OK = 50;
const PAUSED_STATUSES = ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"];

export type AdState = "good" | "warn" | "bad" | "info" | "muted";
export interface CampaignHealth {
  state: AdState;
  label: string;
  reason: string;
}

interface ScoreInput {
  effectiveStatus?: string | null;
  spend: number;
  clicks: number;
  leads: number;
  cpa?: number | null;
  ctr?: number | null;
}

export function campaignHealth(c: ScoreInput): CampaignHealth {
  if (c.effectiveStatus && PAUSED_STATUSES.includes(c.effectiveStatus)) {
    return { state: "muted", label: "Pausiert", reason: "Diese Kampagne läuft gerade nicht." };
  }
  if (c.spend < MIN_DECISION_SPEND) {
    return { state: "info", label: "Sammeln", reason: "Noch zu wenig Daten für eine Bewertung." };
  }
  let points = 0;
  const ctr = c.ctr ?? 0;
  if (ctr >= CTR_STRONG) points += 2;
  else if (ctr >= CTR_OK) points += 1;
  else if (ctr > 0) points -= 1;

  if (c.leads > 0) {
    points += 2;
    const cpa = c.cpa ?? 9999;
    if (cpa <= CPA_STRONG) points += 2;
    else if (cpa <= CPA_OK) points += 1;
    else points -= 1;
  } else {
    if (c.spend >= NO_RESULT_SPEND && c.clicks >= 50) points -= 3;
    else if (c.spend >= NO_RESULT_SPEND) points -= 2;
    else if (c.clicks >= 50) points -= 1;
  }

  if (points >= 4) return { state: "good", label: "Gut", reason: "Läuft stark – Skalierung prüfen." };
  if (points <= -2) return { state: "bad", label: "Handeln", reason: "Schwache Leistung – nicht weiter Budget geben." };
  return { state: "warn", label: "Beobachten", reason: "Im Mittelfeld – weiter beobachten." };
}

const RANK: Record<AdState, number> = { bad: 0, good: 1, warn: 2, info: 3, muted: 4 };
/** Sortierung: handlungsbedürftige zuerst, dann nach Ausgaben, dann Name. */
export function campaignSortKey(a: { health: CampaignHealth; spend: number; name: string }, b: { health: CampaignHealth; spend: number; name: string }): number {
  const r = RANK[a.health.state] - RANK[b.health.state];
  if (r !== 0) return r;
  if (b.spend !== a.spend) return b.spend - a.spend;
  return a.name.localeCompare(b.name);
}

/** Bis zu 3 kurze Handlungsempfehlungen aus den bewerteten Kampagnen. */
export function dashboardRecommendations(items: { name: string; health: CampaignHealth; cpa?: number | null }[]): string[] {
  const recs: string[] = [];
  for (const it of items) {
    if (recs.length >= 3) break;
    if (it.health.state === "bad") recs.push(`„${it.name}" schwächelt – Creative tauschen oder pausieren.`);
    else if (it.health.state === "good") recs.push(`„${it.name}" läuft stark${it.cpa ? ` (${it.cpa} €/Lead)` : ""} – Budget erhöhen.`);
  }
  return recs;
}

// ── Launch-Logik (Campaign → Ad Set → Creative → Ad, alles PAUSED) ─────────
function disabledAdvantageCreativeSpec() {
  // Keine automatischen Meta-Umgestaltungen. Hinweis: `standard_enhancements` ist
  // bei Meta inzwischen veraltet und führt zu einem Fehler – daher NICHT mehr setzen.
  return {
    creative_features_spec: {
      advantage_plus_creative: { enroll_status: "OPT_OUT" },
      text_optimizations: { enroll_status: "OPT_OUT" },
      video_auto_crop: { enroll_status: "OPT_OUT" },
      image_templates: { enroll_status: "OPT_OUT" },
    },
  };
}

type SelLocation = { type: string; key?: string; name?: string; radiusKm?: number; latitude?: number; longitude?: number };
type SelInterest = { id: string; name?: string };

function parseJsonArr<T>(s: string): T[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? (a as T[]) : [];
  } catch {
    return [];
  }
}

function buildLaunchTargeting(d: AdDraft) {
  const t: Record<string, unknown> = {
    age_min: d.ageMin,
    age_max: d.ageMax,
    // Wie die bewährten Alt-Anzeigen: Facebook + Instagram, automatische Platzierungen
    // (Feed, Reels, Stories) – keine Beschränkung auf nur Feed.
    publisher_platforms: ["facebook", "instagram"],
    // Sprache Deutsch (locale 5) – wie in den bestehenden Konten gesetzt.
    locales: [5],
    // Advantage+ Audience AUS – exakt die gewählte Zielgruppe, kein automatisches Aufblähen.
    targeting_automation: { advantage_audience: 0 },
  };

  // Orte direkt aus Facebook (per adgeolocation gewählt) → geo_locations-Buckets
  const locs = parseJsonArr<SelLocation>(d.locationsJson);
  const geo: Record<string, unknown> = {};
  const cities: unknown[] = [];
  const regions: unknown[] = [];
  const zips: unknown[] = [];
  const countries: string[] = [];
  const custom: unknown[] = [];
  for (const l of locs) {
    const radius = l.radiusKm && l.radiusKm > 0 ? l.radiusKm : 25;
    if (l.type === "city" && l.key) cities.push({ key: l.key, radius, distance_unit: "kilometer" });
    else if (l.type === "region" && l.key) regions.push({ key: l.key });
    else if (l.type === "zip" && l.key) zips.push({ key: l.key });
    else if (l.type === "country" && l.key) countries.push(l.key.toUpperCase());
    else if (l.latitude != null && l.longitude != null) custom.push({ latitude: l.latitude, longitude: l.longitude, radius, distance_unit: "kilometer" });
  }
  if (cities.length) geo.cities = cities;
  if (regions.length) geo.regions = regions;
  if (zips.length) geo.zips = zips;
  if (countries.length) geo.countries = countries;
  if (custom.length) geo.custom_locations = custom;

  // Fallback: einzelner Lat/Lng-Radius (Altfeld) oder ganzes Land
  if (Object.keys(geo).length === 0) {
    if (d.latitude != null && d.longitude != null && d.radiusKm != null) {
      geo.custom_locations = [{ latitude: d.latitude, longitude: d.longitude, radius: d.radiusKm, distance_unit: "kilometer" }];
    } else {
      geo.countries = [(d.country || "AT").toUpperCase()];
    }
  }
  t.geo_locations = geo;

  if (d.gender === "men") t.genders = [1];
  else if (d.gender === "women") t.genders = [2];

  // Zielgruppen/Interessen direkt aus Facebook (per adinterest gewählt)
  const interests = parseJsonArr<SelInterest>(d.interestsJson).filter((i) => i && i.id);
  if (interests.length) {
    t.flexible_spec = [{ interests: interests.map((i) => ({ id: i.id, name: i.name })) }];
  }
  return t;
}

// ── Facebook Targeting-Suche (Orte + Interessen, live aus Meta) ────────────
export interface LocationHit {
  key: string;
  name: string;
  type: string; // city | region | zip | country | subcity | neighborhood | ...
  country?: string;
  region?: string;
}
export async function searchLocations(adAccountId: string, q: string): Promise<LocationHit[]> {
  if (!q.trim()) return [];
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const d = await graphGet("search", token, {
    type: "adgeolocation",
    location_types: JSON.stringify(["city", "region", "zip", "country"]),
    q: q.trim(),
    limit: "12",
  });
  return ((d.data as Record<string, unknown>[]) ?? []).map((r) => ({
    key: String(r.key),
    name: String(r.name ?? ""),
    type: String(r.type ?? "city"),
    country: (r.country_name as string) || (r.country_code as string) || undefined,
    region: (r.region as string) || undefined,
  }));
}

export interface InterestHit {
  id: string;
  name: string;
  audienceSize?: number;
  path?: string;
}
export async function searchInterests(adAccountId: string, q: string): Promise<InterestHit[]> {
  if (!q.trim()) return [];
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const d = await graphGet("search", token, { type: "adinterest", q: q.trim(), limit: "12" });
  return ((d.data as Record<string, unknown>[]) ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    audienceSize: (r.audience_size_upper_bound as number) ?? (r.audience_size as number) ?? undefined,
    path: Array.isArray(r.path) ? (r.path as string[]).join(" › ") : undefined,
  }));
}

// ── Kennzahlen mit Zeitraum (Übersicht + Anzeigen + Leads + Zielgruppen) ────
function timeParams(since?: string, until?: string): Record<string, string> {
  if (since && until) return { time_range: JSON.stringify({ since, until }) };
  return { date_preset: "last_30d" };
}
const INSIGHT_FIELDS = "spend,impressions,reach,clicks,ctr,cpm,frequency,actions";

function metricsFromRow(r: Record<string, unknown>) {
  const spend = Number(r.spend ?? 0) || 0;
  const impressions = Math.round(Number(r.impressions ?? 0)) || 0;
  const reach = Math.round(Number(r.reach ?? 0)) || 0;
  const clicks = Math.round(Number(r.clicks ?? 0)) || 0;
  const actions = r.actions as Action[] | undefined;
  const leads = Math.round(actionValue(actions, LEAD_ACTION_TYPES));
  const linkClicks = Math.round(actionValue(actions, ["link_click"]));
  const ctr = r.ctr != null && Number.isFinite(Number(r.ctr)) ? Number(r.ctr) : null;
  const cpm = r.cpm != null && Number.isFinite(Number(r.cpm)) ? Number(r.cpm) : null;
  const frequency = r.frequency != null && Number.isFinite(Number(r.frequency)) ? Number(r.frequency) : null;
  const cpl = leads > 0 ? Math.round((spend / leads) * 100) / 100 : null;
  return { spend, impressions, reach, clicks, linkClicks, leads, ctr, cpm, frequency, cpl };
}

export interface OverviewTotals {
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number; leads: number; cpl: number | null; ctr: number | null; cpm: number | null;
}
export interface OverviewCampaign {
  id: string; name: string; effectiveStatus: string | null; spend: number; impressions: number; reach: number; clicks: number; linkClicks: number; leads: number; cpl: number | null; ctr: number | null; frequency: number | null; health: CampaignHealth;
}

/** Konto-Kennzahlen + je Kampagne für einen Zeitraum (live), optional nur aktive. */
export async function fetchOverview(adAccountId: string, opts: { since?: string; until?: string; activeOnly?: boolean }): Promise<{ totals: OverviewTotals; campaigns: OverviewCampaign[] }> {
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const act = acc.metaAccountId;
  const tr = timeParams(opts.since, opts.until);

  const [insResp, campResp] = await Promise.all([
    graphGet(`${act}/insights`, token, { level: "campaign", ...tr, fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}`, limit: "400" }),
    graphGet(`${act}/campaigns`, token, { fields: "id,name,effective_status", limit: "400" }),
  ]);
  const statusById = new Map<string, { name: string; status: string | null }>();
  for (const c of (campResp.data as Record<string, unknown>[]) ?? []) statusById.set(String(c.id), { name: String(c.name ?? ""), status: (c.effective_status as string) ?? null });

  const totals: OverviewTotals = { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, leads: 0, cpl: null, ctr: null, cpm: null };
  let campaigns: OverviewCampaign[] = [];
  for (const row of (insResp.data as Record<string, unknown>[]) ?? []) {
    const id = String(row.campaign_id);
    const m = metricsFromRow(row);
    const meta = statusById.get(id);
    const status = meta?.status ?? null;
    if (opts.activeOnly && status !== "ACTIVE") continue;
    totals.spend += m.spend; totals.impressions += m.impressions; totals.reach += m.reach; totals.clicks += m.clicks; totals.linkClicks += m.linkClicks; totals.leads += m.leads;
    const health = campaignHealth({ effectiveStatus: status, spend: m.spend, clicks: m.clicks, leads: m.leads, cpa: m.cpl, ctr: m.ctr });
    campaigns.push({ id, name: meta?.name || String(row.campaign_name ?? "(Kampagne)"), effectiveStatus: status, spend: m.spend, impressions: m.impressions, reach: m.reach, clicks: m.clicks, linkClicks: m.linkClicks, leads: m.leads, cpl: m.cpl, ctr: m.ctr, frequency: m.frequency, health });
  }
  totals.cpl = totals.leads > 0 ? Math.round((totals.spend / totals.leads) * 100) / 100 : null;
  totals.ctr = totals.impressions > 0 ? Math.round((totals.clicks / totals.impressions) * 1000) / 10 : null;
  totals.cpm = totals.impressions > 0 ? Math.round((totals.spend / totals.impressions) * 100000) / 100 : null;
  campaigns = campaigns.sort((a, b) => campaignSortKey({ health: a.health, spend: a.spend, name: a.name }, { health: b.health, spend: b.spend, name: b.name }));
  return { totals, campaigns };
}

export interface AdRow {
  id: string; name: string; effectiveStatus: string | null; campaign: string | null; thumbnailUrl: string | null; objectType: string | null;
  spend: number; impressions: number; reach: number; leads: number; cpl: number | null; ctr: number | null;
}

/** Einzelne Anzeigen (mit Creative-Vorschaubild) + Kennzahlen für einen Zeitraum. */
export async function listAdsWithInsights(adAccountId: string, opts: { since?: string; until?: string; activeOnly?: boolean }): Promise<AdRow[]> {
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const act = acc.metaAccountId;
  const tr = timeParams(opts.since, opts.until);

  const [adsResp, insResp] = await Promise.all([
    graphGet(`${act}/ads`, token, { fields: "id,name,effective_status,campaign{name},creative{thumbnail_url,object_type,video_id}", limit: "200" }),
    graphGet(`${act}/insights`, token, { level: "ad", ...tr, fields: `ad_id,${INSIGHT_FIELDS}`, limit: "500" }),
  ]);
  const byAd = new Map<string, Record<string, unknown>>();
  for (const r of (insResp.data as Record<string, unknown>[]) ?? []) byAd.set(String(r.ad_id), r);

  const rows: AdRow[] = [];
  for (const ad of (adsResp.data as Record<string, unknown>[]) ?? []) {
    const status = (ad.effective_status as string) ?? null;
    if (opts.activeOnly && status !== "ACTIVE") continue;
    const creative = (ad.creative as Record<string, unknown>) ?? {};
    const m = metricsFromRow(byAd.get(String(ad.id)) ?? {});
    rows.push({
      id: String(ad.id), name: String(ad.name ?? "(Anzeige)"), effectiveStatus: status,
      campaign: ((ad.campaign as Record<string, unknown>)?.name as string) ?? null,
      thumbnailUrl: (creative.thumbnail_url as string) ?? null,
      objectType: (creative.object_type as string) ?? (creative.video_id ? "VIDEO" : null),
      spend: m.spend, impressions: m.impressions, reach: m.reach, leads: m.leads, cpl: m.cpl, ctr: m.ctr,
    });
  }
  return rows.sort((a, b) => b.spend - a.spend);
}

export interface LeadRow { id: string; createdTime: string; form: string; name?: string; phone?: string; email?: string; city?: string; fields: { key: string; value: string }[]; }

/** Echte Leads aus den Sofortformularen (über alle Seiten des Tokens). */
export async function listLeads(adAccountId: string, take = 50): Promise<{ leads: LeadRow[]; totalForms: number; forms: { name: string; count: number }[]; note?: string }> {
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const pagesResp = await graphGet("me/accounts", token, { fields: "id,name,access_token", limit: "25" });
  const pages = (pagesResp.data as Record<string, unknown>[]) ?? [];
  const leads: LeadRow[] = [];
  const formCounts: { name: string; count: number }[] = [];
  let totalForms = 0;
  let permissionBlocked = false;
  for (const page of pages) {
    const pageToken = String(page.access_token ?? token);
    const formsResp = await graphGet(`${page.id}/leadgen_forms`, pageToken, { fields: "id,name,leads_count", limit: "100" }).catch(() => ({ data: [] }));
    const allForms = (formsResp.data as Record<string, unknown>[]) ?? [];
    totalForms += allForms.length;
    for (const f of allForms) if (Number(f.leads_count ?? 0) > 0) formCounts.push({ name: String(f.name ?? "Formular"), count: Number(f.leads_count) });
    // Formulare mit (bekannten) Leads zuerst; leads_count fehlt manchmal → dann alle versuchen.
    const forms = [...allForms].sort((a, b) => Number(b.leads_count ?? 0) - Number(a.leads_count ?? 0)).slice(0, 20);
    for (const form of forms) {
      const leadsResp = await graphGet(`${form.id}/leads`, pageToken, { fields: "created_time,field_data", limit: String(take) }).catch((e) => {
        if (/leads_retrieval|#200/i.test(e instanceof Error ? e.message : "")) permissionBlocked = true;
        return { data: [] };
      });
      for (const l of (leadsResp.data as Record<string, unknown>[]) ?? []) {
        const fd = (l.field_data as { name: string; values: string[] }[]) ?? [];
        const get = (...keys: string[]) => fd.find((f) => keys.some((k) => (f.name || "").toLowerCase().includes(k)))?.values?.[0];
        leads.push({
          id: String(l.id ?? Math.random()), createdTime: String(l.created_time ?? ""), form: String(form.name ?? ""),
          name: get("full_name", "name"), phone: get("phone"), email: get("email"), city: get("city", "ort"),
          fields: fd.map((f) => ({ key: f.name, value: (f.values || []).join(", ") })),
        });
      }
    }
  }
  leads.sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1));
  formCounts.sort((a, b) => b.count - a.count);
  let note: string | undefined;
  if (leads.length === 0) {
    if (permissionBlocked) note = `Die Kontaktdaten brauchen den Lead-Zugriff auf Seiten-Ebene für den System-User (Business-Einstellungen → Integrationen → Lead-Zugriff → Seite). Wirkt evtl. erst nach ein paar Minuten. Die Anzahl pro Formular siehst du schon.`;
    else if (totalForms === 0) note = "Keine Sofortformulare – Leads laufen über Website-Conversions (Pixel).";
    else if (formCounts.length === 0) note = "Noch keine Formular-Leads (oder Leads laufen über Website-Conversions).";
  }
  return { leads: leads.slice(0, take), totalForms, forms: formCounts.slice(0, 30), note };
}

/** Holt die Meta-Leads und persistiert sie (Dedup über metaLeadId) – fürs CRM. Liefert Anzahl neuer Leads. */
export async function syncLeads(adAccountId: string): Promise<{ total: number; created: number; note?: string }> {
  const data = await listLeads(adAccountId, 200);
  let created = 0;
  for (const l of data.leads) {
    const exists = await prisma.lead.findUnique({ where: { metaLeadId_adAccountId: { metaLeadId: l.id, adAccountId } }, select: { id: true } });
    if (exists) {
      // Kontaktdaten auffrischen, CRM-Felder (status/notes) NICHT überschreiben
      await prisma.lead.update({
        where: { id: exists.id },
        data: { name: l.name ?? null, phone: l.phone ?? null, email: l.email ?? null, city: l.city ?? null, leadFormName: l.form, fieldDataJson: JSON.stringify(l.fields) },
      });
    } else {
      await prisma.lead.create({
        data: {
          adAccountId, metaLeadId: l.id, leadFormName: l.form,
          name: l.name ?? null, phone: l.phone ?? null, email: l.email ?? null, city: l.city ?? null,
          fieldDataJson: JSON.stringify(l.fields),
          receivedAt: l.createdTime ? new Date(l.createdTime) : new Date(),
        },
      });
      created++;
    }
  }
  return { total: data.leads.length, created, note: data.note };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Lädt ein Video zu Meta (Meta holt es von der URL) und wartet kurz auf die Verarbeitung. */
export async function uploadVideoFromUrl(adAccountId: string, fileUrl: string, name: string): Promise<{ videoId: string; ready: boolean }> {
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const res = await graphPost(`${acc.metaAccountId}/advideos`, token, { file_url: fileUrl, name: (name || "Video").slice(0, 200) });
  const videoId = String(res.id ?? "");
  if (!videoId) throw new Error("Video-Upload fehlgeschlagen (keine ID von Meta).");
  // Auf Verarbeitung warten (max ~24s) – ein pausiertes Creative braucht ein fertiges Video.
  let ready = false;
  for (let i = 0; i < 8; i++) {
    await sleep(3000);
    const st = (await graphGet(videoId, token, { fields: "status" }).catch(() => ({} as Record<string, unknown>)));
    const status = (st.status as { video_status?: string } | undefined)?.video_status;
    if (status === "ready") { ready = true; break; }
    if (status === "error") throw new Error("Meta konnte das Video nicht verarbeiten.");
  }
  return { videoId, ready };
}

export interface LeadFormRow { id: string; name: string; status: string; leadsCount: number; }

/** Bestehende Lead-Formulare aller Seiten (zum Wiederverwenden in neuen Anzeigen). */
export async function listLeadForms(adAccountId: string): Promise<LeadFormRow[]> {
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const pagesResp = await graphGet("me/accounts", token, { fields: "id,access_token", limit: "25" });
  const pages = (pagesResp.data as Record<string, unknown>[]) ?? [];
  const forms: LeadFormRow[] = [];
  for (const page of pages) {
    const pageToken = String(page.access_token ?? token);
    const r = await graphGet(`${page.id}/leadgen_forms`, pageToken, { fields: "id,name,status,leads_count", limit: "100" }).catch(() => ({ data: [] }));
    for (const f of (r.data as Record<string, unknown>[]) ?? []) {
      forms.push({ id: String(f.id), name: String(f.name ?? "Formular"), status: String(f.status ?? ""), leadsCount: Number(f.leads_count ?? 0) });
    }
  }
  // Aktive + mit Leads zuerst, Test-/LocalAds-Formulare nach hinten
  return forms.sort((a, b) => b.leadsCount - a.leadsCount).filter((f) => !/^LocalAds \| .* \| .{6}$/.test(f.name)).slice(0, 40);
}

export interface SavedAudience { id: string; name: string; size?: number; summary: string; targeting?: unknown; }

/** Gespeicherte Zielgruppen des Kontos (zum Übernehmen für neue Anzeigen). */
export async function listSavedAudiences(adAccountId: string): Promise<SavedAudience[]> {
  const acc = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
  if (!acc) throw new Error("Werbekonto nicht gefunden.");
  const token = await accountToken(acc);
  const d = await graphGet(`${acc.metaAccountId}/saved_audiences`, token, { fields: "id,name,approximate_count_lower_bound,targeting", limit: "100" }).catch(() => ({ data: [] }));
  return ((d.data as Record<string, unknown>[]) ?? []).map((s) => {
    const t = (s.targeting as Record<string, unknown>) ?? {};
    const geo = (t.geo_locations as Record<string, unknown>) ?? {};
    const parts: string[] = [];
    const regs = (geo.regions as { name?: string }[]) ?? [];
    const cits = (geo.cities as { name?: string }[]) ?? [];
    const ctrs = (geo.countries as string[]) ?? [];
    if (regs.length) parts.push(regs.map((r) => r.name).filter(Boolean).join(", "));
    if (cits.length) parts.push(cits.map((c) => c.name).filter(Boolean).join(", "));
    if (!regs.length && !cits.length && ctrs.length) parts.push(ctrs.join(", "));
    const ints = ((t.flexible_spec as { interests?: { name?: string }[] }[]) ?? []).flatMap((f) => (f.interests ?? []).map((i) => i.name)).filter(Boolean);
    if (ints.length) parts.push(ints.slice(0, 4).join(", ") + (ints.length > 4 ? " …" : ""));
    if (t.age_min || t.age_max) parts.push(`${t.age_min ?? 18}–${t.age_max ?? 65} J.`);
    return { id: String(s.id), name: String(s.name ?? ""), size: (s.approximate_count_lower_bound as number) ?? undefined, summary: parts.join(" · ") || "Zielgruppe", targeting: t };
  });
}

function slug(s: string, max = 40): string {
  // Wie das Original (safe_filename → "-"→"_"): Nicht-[a-z0-9._-] → "-", dann "-" → "_". Kein NFKD.
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
  return cleaned || "frage";
}

type MetaQuestion = { type: string; key?: string; label?: string };
function questionsToMeta(questions: string[]): MetaQuestion[] {
  if (!questions.length) return [{ type: "FULL_NAME" }, { type: "PHONE" }, { type: "CITY" }];
  return questions.map((q) => {
    const low = q.toLowerCase();
    if (low.includes("name")) return { type: "FULL_NAME" };
    if (low.includes("telefon") || low.includes("phone")) return { type: "PHONE" };
    if (low.includes("email") || low.includes("e-mail")) return { type: "EMAIL" };
    return { type: "CUSTOM", key: slug(q), label: q.slice(0, 80) };
  });
}

async function defaultPageForLaunch(token: string, preferredPageId?: string | null): Promise<{ pageId: string; pageToken: string }> {
  const d = await graphGet("me/accounts", token, { fields: "id,name,access_token", limit: "100" });
  const pages = (d.data as Record<string, unknown>[]) ?? [];
  if (!pages.length) throw new Error("Keine Facebook-Seite mit diesem Token gefunden (Seiten-Rechte fehlen).");
  let page = pages[0];
  if (preferredPageId) {
    const found = pages.find((p) => String(p.id) === preferredPageId);
    if (!found) throw new Error(`Bevorzugte Seite ${preferredPageId} nicht in den Seiten des Tokens.`);
    page = found;
  }
  return { pageId: String(page.id), pageToken: String(page.access_token ?? token) };
}

function draftQuestions(d: AdDraft): string[] {
  try {
    const a = JSON.parse(d.questionsJson);
    return Array.isArray(a) ? a.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export interface LaunchResult {
  campaignId: string;
  adsetId: string;
  creativeId: string;
  adId: string;
  leadFormId?: string;
}

/** Erstellt aus einem Entwurf eine vollständige (pausierte) Meta-Kampagne. */
export async function launchDraftToMeta(draftId: string): Promise<LaunchResult> {
  const draft = await prisma.adDraft.findUnique({ where: { id: draftId }, include: { adAccount: true } });
  if (!draft) throw new Error("Entwurf nicht gefunden.");

  // Bereits gelauncht? Nicht erneut erstellen (sonst Duplikat-Kampagnen) – idempotent zurückgeben.
  if (draft.status === "launched" && draft.metaCampaignId) {
    return {
      campaignId: draft.metaCampaignId,
      adsetId: draft.metaAdsetId || "",
      creativeId: draft.metaCreativeId || "",
      adId: draft.metaAdId || "",
      leadFormId: draft.leadFormId || undefined,
    };
  }

  const acc = draft.adAccount;
  const destination = draft.destination === "website" ? "website" : "lead_form";
  const budgetCents = Math.max(100, Math.round(draft.budget * 100));
  const primaryText = draft.primaryText || draft.offer;
  const headline = draft.headline || draft.offer;
  const websiteUrl = (draft.websiteUrl || "").trim();
  const imageUrl = (draft.imageUrl || "").trim();
  const country = (draft.country || "AT").toUpperCase();

  // Der gesamte Ablauf liegt in try/catch – so wird launchError IMMER persistiert
  // (auch bei frühen Validierungs-/Seiten-/Lead-Form-Fehlern).
  let campaignId = "";
  try {
    const token = await accountToken(acc);
    const act = acc.metaAccountId;

    // Vorab-Validierung – sauberer Frühabbruch statt halb erstellter Kampagne
    if (country.length !== 2) throw new Error("Land muss ein 2-Buchstaben-Code sein (z. B. AT).");
    if (draft.ageMin < 18 || draft.ageMax < draft.ageMin) throw new Error("Altersangabe ungültig (min. 18, max ≥ min).");
    if (destination === "website" && !/^https?:\/\//i.test(websiteUrl)) {
      throw new Error("Für ein Website-Ziel ist eine gültige Website-URL (http/https) nötig.");
    }

    // 1) Facebook-Seite – für Lead-Form-Creatives UND Website-Creatives zwingend (page_id im object_story_spec)
    const page = await defaultPageForLaunch(token, acc.pageId);
    const pageId = page.pageId;
    const pageToken = page.pageToken;

    // 2) Lead-Formular (nur lead_form, falls noch keins existiert)
    let leadFormId = draft.leadFormId || "";
    if (destination === "lead_form" && !leadFormId) {
      const privacy = (draft.privacyUrl || websiteUrl).trim();
      if (!/^https?:\/\//i.test(privacy)) {
        throw new Error("Für ein Lead-Formular ist ein Datenschutz-/Website-Link (http/https) nötig.");
      }
      const questions = questionsToMeta(draftQuestions(draft));
      const formRes = await graphPost(`${pageId}/leadgen_forms`, pageToken, {
        // Formularname muss pro Seite eindeutig sein → Entwurfs-ID anhängen.
        name: `LocalAds | ${draft.offer} | ${draft.region} | ${draft.id.slice(-6)}`.slice(0, 120),
        locale: "de_DE",
        questions: JSON.stringify(questions),
        privacy_policy: JSON.stringify({ url: privacy, link_text: "Datenschutz" }),
        follow_up_action_url: privacy,
        status: "ACTIVE",
      });
      leadFormId = String(formRes.id ?? "");
      if (!leadFormId) throw new Error("Lead-Formular konnte nicht erstellt werden.");
    }

    // 3) Kampagne (ab hier alles PAUSED). special_ad_categories wie im erprobten Original = [].
    // (Hinweis: echte Stellenanzeigen brauchen perspektivisch EMPLOYMENT + angepasstes Targeting.)
    const campaign = await graphPost(`${act}/campaigns`, token, {
      name: `LocalAds | ${headline} | ${draft.region}`.slice(0, 200),
      objective: destination === "lead_form" ? "OUTCOME_LEADS" : "OUTCOME_TRAFFIC",
      buying_type: "AUCTION",
      special_ad_categories: "[]",
      // Budget liegt auf Ad-Set-Ebene (kein CBO) – Meta verlangt dieses Flag explizit.
      is_adset_budget_sharing_enabled: "false",
      status: "PAUSED",
    });
    campaignId = String(campaign.id);

    // 4) Ad Set
    const adsetBody: Record<string, string> = {
      name: `${draft.region} | ${draft.budget} EUR/Tag | pausiert`.slice(0, 200),
      campaign_id: campaignId,
      daily_budget: String(budgetCents),
      billing_event: "IMPRESSIONS",
      optimization_goal: destination === "lead_form" ? "LEAD_GENERATION" : "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: JSON.stringify(buildLaunchTargeting(draft)),
      status: "PAUSED",
    };
    if (destination === "lead_form") {
      adsetBody.promoted_object = JSON.stringify({ page_id: pageId });
      adsetBody.destination_type = "ON_AD"; // Sofort-Lead-Formular (Instant Form)
    }
    const adset = await graphPost(`${act}/adsets`, token, adsetBody);
    const adsetId = String(adset.id);

    // 5) Creative (object_story_spec). Meta verlangt im link_data ein Pflicht-`link`;
    // bei Lead-Anzeigen ohne Website nehmen wir den Datenschutz-Link als gültigen Fallback.
    const linkUrl = websiteUrl || (draft.privacyUrl || "").trim();
    if (!/^https?:\/\//i.test(linkUrl)) {
      throw new Error("Es fehlt ein gültiger Link (Website- oder Datenschutz-Link, http/https).");
    }
    const callToAction = destination === "lead_form"
      ? { type: "SIGN_UP", value: { lead_gen_form_id: leadFormId, link: linkUrl } }
      : { type: "LEARN_MORE", value: { link: linkUrl } };

    let story: Record<string, unknown>;
    if (draft.videoId) {
      // Video-Anzeige (object_story_spec.video_data) – Meta verlangt ein Miniaturbild.
      let thumb = imageUrl;
      if (!thumb) {
        const th = await graphGet(draft.videoId, token, { fields: "thumbnails{uri,is_preferred}" }).catch(() => ({} as Record<string, unknown>));
        const thumbs = ((th.thumbnails as { data?: { uri: string; is_preferred?: boolean }[] } | undefined)?.data) ?? [];
        thumb = (thumbs.find((t) => t.is_preferred) ?? thumbs[0])?.uri ?? "";
      }
      const videoData: Record<string, unknown> = { video_id: draft.videoId, message: primaryText, title: headline, call_to_action: callToAction };
      if (thumb) videoData.image_url = thumb;
      story = { page_id: pageId, video_data: videoData };
    } else {
      const linkData: Record<string, unknown> = {
        link: linkUrl,
        message: primaryText,
        name: headline,
        description: `${draft.offer} in ${draft.region}`,
        call_to_action: callToAction,
      };
      if (imageUrl) linkData.picture = imageUrl;
      story = { page_id: pageId, link_data: linkData };
    }

    const creative = await graphPost(`${act}/adcreatives`, token, {
      name: `Creative | ${headline}`.slice(0, 200),
      object_story_spec: JSON.stringify(story),
      degrees_of_freedom_spec: JSON.stringify(disabledAdvantageCreativeSpec()),
    });
    const creativeId = String(creative.id);

    // 6) Anzeige
    const ad = await graphPost(`${act}/ads`, token, {
      name: `Ad | ${headline}`.slice(0, 200),
      adset_id: adsetId,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: "PAUSED",
    });
    const adId = String(ad.id);

    await prisma.adDraft.update({
      where: { id: draft.id },
      data: {
        status: "launched",
        metaCampaignId: campaignId,
        metaAdsetId: adsetId,
        metaCreativeId: creativeId,
        metaAdId: adId,
        leadFormId: leadFormId || null,
        launchError: null,
        launchedAt: new Date(),
      },
    });

    // Best-Effort: frisch syncen, damit die neue (pausierte) Kampagne sofort auftaucht.
    await syncCampaigns(acc.id).catch(() => {});
    return { campaignId, adsetId, creativeId, adId, leadFormId: leadFormId || undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.adDraft
      .update({
        where: { id: draft.id },
        data: { status: "launch_error", metaCampaignId: campaignId || null, launchError: msg },
      })
      .catch(() => {});
    throw new Error(msg);
  }
}
