export type LeadStage = 
  | 'new' 
  | 'contacted' 
  | 'follow_up'
  | 'qualified' 
  | 'unqualified'
  | 'meeting_scheduled' 
  | 'meeting_done'
  | 'no_show'
  | 'won' 
  | 'lost';

export type LeadSource = 
  | 'facebook' 
  | 'instagram' 
  | 'google' 
  | 'website' 
  | 'referral' 
  | 'phone' 
  | 'other';

export interface ContactLog {
  id: string;
  date: string;
  /** website = erneute Anfrage über die Website (kommt automatisch, kein eigener Kontakt) */
  type: 'call' | 'email' | 'meeting' | 'note' | 'website';
  comment: string;
  reachedCustomer: boolean;
}

export interface Lead {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  companyName?: string;
  source: LeadSource;
  stage: LeadStage;
  createdAt: string;
  updatedAt: string;
  isEntrepreneur?: boolean;
  hasMoreThan5Employees?: boolean;
  qualificationNotes?: string;
  meetingDate?: string;
  meetingAppeared?: boolean;
  saleAmount?: number;
  callbackDate?: string; // Wann wieder anrufen?
  callbackComment?: string; // Kommentar zum Rückruf
  callbackSetAt?: string; // Wann wurde der Callback gesetzt?
  contactLogs: ContactLog[];
  customerWishes?: string;
  adName?: string;
  campaignName?: string;
  platform?: string;
  offerId?: string | null;
}

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'Neu',
  contacted: 'Erstkontakt',
  follow_up: 'Follow Up',
  qualified: 'Qualifiziert',
  unqualified: 'Unqualifiziert',
  meeting_scheduled: 'Termin geplant',
  meeting_done: 'Termin erfolgt',
  no_show: 'Nicht erschienen',
  won: 'Verkauft',
  lost: 'Verloren',
};

/** Farbe je Quelle – Website hebt sich klar von den Anzeigen ab. */
export const SOURCE_STYLE: Record<LeadSource, string> = {
  facebook: 'bg-blue-100 text-blue-800',
  instagram: 'bg-pink-100 text-pink-800',
  google: 'bg-amber-100 text-amber-800',
  website: 'bg-emerald-100 text-emerald-800',
  referral: 'bg-violet-100 text-violet-800',
  phone: 'bg-slate-200 text-slate-800',
  other: 'bg-muted text-muted-foreground',
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google Ads',
  website: 'Website',
  referral: 'Empfehlung',
  phone: 'Telefon',
  other: 'Sonstige',
};
