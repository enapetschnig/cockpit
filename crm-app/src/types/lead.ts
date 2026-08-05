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
  type: 'call' | 'email' | 'meeting' | 'note';
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

export const SOURCE_LABELS: Record<LeadSource, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google Ads',
  website: 'Website',
  referral: 'Empfehlung',
  phone: 'Telefon',
  other: 'Sonstige',
};
