export type Priority = "hi" | "mid" | "lo";

export interface EmailDTO {
  id: string;
  account: "firma" | "privat" | string;
  fromAddr: string;
  fromName: string;
  subject: string;
  body: string;
  receivedAt: string;
  summary: string | null;
  labels: string[];
  firmenrelevant: boolean;
  priority: Priority | string;
  filed: boolean;
  outgoing: boolean;
  customerId: string | null;
  customer: { id: string; name: string; meta: string | null; color: string | null } | null;
}

export interface CustomerDTO {
  id: string;
  name: string;
  meta: string | null;
  color: string | null;
  openTodos: number;
  todos: { id: string; text: string; done: boolean }[];
  emailCount: number;
}

export interface ClassifyResult {
  summary: string;
  labels: string[];
  firmenrelevant: boolean;
  priority: Priority;
  suggestedTodos: string[];
  proposedEvent?: { title: string; start: string; end: string } | null;
}

// ── Buchhaltung ──────────────────────────────────────────────
export type BelegKind = "rechnung" | "kontoauszug" | "kreditkarte";
export type BelegStatus =
  | "collected"
  | "needs_review"
  | "queued"
  | "uploading"
  | "uploaded"
  | "failed"
  | "skipped";

export interface BelegDTO {
  id: string;
  kind: BelegKind | string;
  source: string;
  vendor: string;
  vendorKey: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  periodMonth: string | null;
  amount: string | null; // Decimal als String (kein Float-Drift)
  currency: string;
  fileName: string | null;
  status: BelegStatus | string;
  attempts: number;
  bmdUploadedAt: string | null;
  bmdError: string | null;
  confirmation: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

export interface BuchungDTO {
  id: string;
  belegId: string;
  bookingDate: string;
  amount: string; // Decimal als String
  currency: string;
  counterparty: string | null;
  purpose: string | null;
  reference: string | null;
  matchedBelegId: string | null;
  matchStatus: "unmatched" | "matched" | "ignored" | string;
  matchConfidence: number | null;
}

// ── CRM: Leads ───────────────────────────────────────────────
export interface LeadActivityDTO {
  id: string;
  channel: string; // call | whatsapp | email | visit | note
  note: string;
  outcome: string | null;
  createdAt: string;
}
export interface LeadDTO {
  id: string;
  adAccountId: string;
  leadFormName: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  fields: { key: string; value: string }[];
  status: string; // new | contacted | scheduled | won | lost
  notes: string | null;
  scheduledFor: string | null;
  lastContactedAt: string | null;
  receivedAt: string;
  seenAt: string | null; // null = neu/ungesehen
  activities: LeadActivityDTO[];
}
export interface LeadStageDTO {
  id: string;
  key: string;
  label: string;
  color: string; // Hex
  order: number;
  isDefault: boolean;
}

export interface ReconcileMonthDTO {
  periodMonth: string;
  matched: { buchung: BuchungDTO; beleg: BelegDTO }[];
  bookingsWithoutInvoice: BuchungDTO[]; // ⚠️ Buchung ohne Beleg
  invoicesWithoutBooking: BelegDTO[]; // 📄 Rechnung ohne Buchung
}

// ── Werbeanzeigen (Meta Ads) ─────────────────────────────────
export type AdState = "good" | "warn" | "bad" | "info" | "muted";

export interface AdAccountDTO {
  id: string;
  label: string;
  metaAccountId: string;
  accountName: string | null;
  currency: string | null;
  status: string; // not_connected | connected | error
  lastError: string | null;
  lastSyncAt: string | null;
  hasToken: boolean;
  privacyPolicyUrl: string | null;
}

export interface AdCampaignDTO {
  id: string;
  adAccountId: string;
  name: string;
  objective: string | null;
  effectiveStatus: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  leads: number;
  cpa: number | null;
  ctr: number | null;
  frequency: number | null;
  health: { state: AdState; label: string; reason: string };
}

export interface AdLocation {
  type: string; // city | region | zip | country | custom
  key?: string;
  name?: string;
  radiusKm?: number;
  latitude?: number;
  longitude?: number;
}
export interface AdInterest {
  id: string;
  name?: string;
}

export interface AdDraftDTO {
  id: string;
  adAccountId: string;
  goal: string;
  offer: string;
  region: string;
  benefit: string | null;
  details: string | null;
  budget: number;
  destination: string;
  websiteUrl: string | null;
  privacyUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  gender: string | null;
  ageMin: number;
  ageMax: number;
  tone: string;
  locations: AdLocation[];
  interests: AdInterest[];
  headline: string | null;
  primaryText: string | null;
  creativeNote: string | null;
  questions: string[];
  status: string; // needs_review | awaiting_review | approved | rejected | launched | launch_error
  reviewComment: string | null;
  launchError: string | null;
  metaCampaignId: string | null;
  createdAt: string;
}
