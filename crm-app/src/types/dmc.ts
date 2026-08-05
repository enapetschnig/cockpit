export type DmcStage = 
  | 'new' 
  | 'letter_sent' 
  | 'address_wrong'
  | 'ready'
  | 'contacted' 
  | 'interested' 
  | 'not_interested' 
  | 'won' 
  | 'lost';

export const DMC_STAGE_LABELS: Record<DmcStage, string> = {
  new: 'Neu',
  letter_sent: 'Brief verschickt',
  address_wrong: 'Adresse falsch',
  ready: 'Bereit',
  contacted: 'Kontaktiert',
  interested: 'Interesse',
  not_interested: 'Kein Interesse',
  won: 'Gewonnen',
  lost: 'Verloren',
};

export const DMC_STAGES: DmcStage[] = [
  'new',
  'letter_sent',
  'address_wrong',
  'ready',
  'contacted',
  'interested',
  'not_interested',
  'won',
  'lost',
];

export interface DmcContact {
  id: string;
  user_id: string;
  company_name: string;
  ceo_name: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  phone: string | null;
  email: string | null;
  source_url: string | null;
  stage: DmcStage;
  letter_sent_date: string | null;
  first_contact_date: string | null;
  contact_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DmcContactInsert {
  company_name: string;
  ceo_name?: string | null;
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
  region?: string | null;
  phone?: string | null;
  email?: string | null;
  source_url?: string | null;
  stage?: DmcStage;
  letter_sent_date?: string | null;
  first_contact_date?: string | null;
  contact_notes?: string | null;
}

export interface DmcContactUpdate {
  company_name?: string;
  ceo_name?: string | null;
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
  region?: string | null;
  phone?: string | null;
  email?: string | null;
  source_url?: string | null;
  stage?: DmcStage;
  letter_sent_date?: string | null;
  first_contact_date?: string | null;
  contact_notes?: string | null;
}
