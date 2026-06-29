import type { Email, Customer, Todo, Beleg, Buchung, AdAccount, AdCampaign, AdDraft } from "@prisma/client";
import type { EmailDTO, CustomerDTO, BelegDTO, BuchungDTO, AdAccountDTO, AdCampaignDTO, AdDraftDTO } from "./types";

function safeLabels(s: string): string[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export function toEmailDTO(e: Email & { customer?: Customer | null }): EmailDTO {
  return {
    id: e.id,
    account: e.account,
    fromAddr: e.fromAddr,
    fromName: e.fromName,
    subject: e.subject,
    body: e.body,
    receivedAt: e.receivedAt.toISOString(),
    summary: e.summary,
    labels: safeLabels(e.labelsJson),
    firmenrelevant: e.firmenrelevant,
    priority: e.priority,
    filed: e.filed,
    outgoing: e.outgoing,
    customerId: e.customerId,
    customer: e.customer
      ? { id: e.customer.id, name: e.customer.name, meta: e.customer.meta, color: e.customer.color }
      : null,
  };
}

export function toBelegDTO(b: Beleg): BelegDTO {
  return {
    id: b.id,
    kind: b.kind,
    source: b.source,
    vendor: b.vendor,
    vendorKey: b.vendorKey,
    invoiceNumber: b.invoiceNumber,
    invoiceDate: b.invoiceDate ? b.invoiceDate.toISOString() : null,
    periodMonth: b.periodMonth,
    amount: b.amount != null ? b.amount.toString() : null,
    currency: b.currency,
    fileName: b.fileName,
    status: b.status,
    attempts: b.attempts,
    bmdUploadedAt: b.bmdUploadedAt ? b.bmdUploadedAt.toISOString() : null,
    bmdError: b.bmdError,
    confirmation: b.confirmation,
    sourceUrl: b.sourceUrl,
    createdAt: b.createdAt.toISOString(),
  };
}

export function toBuchungDTO(b: Buchung): BuchungDTO {
  return {
    id: b.id,
    belegId: b.belegId,
    bookingDate: b.bookingDate.toISOString(),
    amount: b.amount.toString(),
    currency: b.currency,
    counterparty: b.counterparty,
    purpose: b.purpose,
    reference: b.reference,
    matchedBelegId: b.matchedBelegId,
    matchStatus: b.matchStatus,
    matchConfidence: b.matchConfidence,
  };
}

export function toAdAccountDTO(a: AdAccount): AdAccountDTO {
  return {
    id: a.id,
    label: a.label,
    metaAccountId: a.metaAccountId,
    accountName: a.accountName,
    currency: a.currency,
    status: a.status,
    lastError: a.lastError,
    lastSyncAt: a.lastSyncAt ? a.lastSyncAt.toISOString() : null,
    hasToken: Boolean(a.tokenCipher),
  };
}

export function toAdCampaignDTO(c: AdCampaign, health: AdCampaignDTO["health"]): AdCampaignDTO {
  return {
    id: c.id,
    adAccountId: c.adAccountId,
    name: c.name,
    objective: c.objective,
    effectiveStatus: c.effectiveStatus,
    spend: c.spend,
    impressions: c.impressions,
    reach: c.reach,
    clicks: c.clicks,
    linkClicks: c.linkClicks,
    leads: c.leads,
    cpa: c.cpa,
    ctr: c.ctr,
    frequency: c.frequency,
    health,
  };
}

function safeArr<T>(s: string): T[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? (a as T[]) : [];
  } catch {
    return [];
  }
}

export function toAdDraftDTO(d: AdDraft): AdDraftDTO {
  return {
    id: d.id,
    adAccountId: d.adAccountId,
    goal: d.goal,
    offer: d.offer,
    region: d.region,
    benefit: d.benefit,
    budget: d.budget,
    destination: d.destination,
    websiteUrl: d.websiteUrl,
    privacyUrl: d.privacyUrl,
    imageUrl: d.imageUrl,
    videoId: d.videoId,
    gender: d.gender,
    ageMin: d.ageMin,
    ageMax: d.ageMax,
    tone: d.tone,
    locations: safeArr(d.locationsJson),
    interests: safeArr(d.interestsJson),
    headline: d.headline,
    primaryText: d.primaryText,
    creativeNote: d.creativeNote,
    questions: safeArr<string>(d.questionsJson).map(String),
    status: d.status,
    launchError: d.launchError,
    metaCampaignId: d.metaCampaignId,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toCustomerDTO(
  c: Customer & { todos?: Todo[]; emails?: Email[] }
): CustomerDTO {
  const todos = c.todos ?? [];
  return {
    id: c.id,
    name: c.name,
    meta: c.meta,
    color: c.color,
    openTodos: todos.filter((t) => !t.done).length,
    todos: todos.map((t) => ({ id: t.id, text: t.text, done: t.done })),
    emailCount: c.emails?.length ?? 0,
  };
}
