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

export interface AdDraftDTO {
  id: string;
  adAccountId: string;
  goal: string;
  offer: string;
  region: string;
  benefit: string | null;
  budget: number;
  destination: string;
  websiteUrl: string | null;
  privacyUrl: string | null;
  imageUrl: string | null;
  headline: string | null;
  primaryText: string | null;
  creativeNote: string | null;
  questions: string[];
  status: string; // needs_review | launched | launch_error
  launchError: string | null;
  metaCampaignId: string | null;
  createdAt: string;
}
