-- Liquiditätsplanung (18.11.2026, Christoph: „was kommt noch rauf, was ist mit USt … jeden Monat nur Kontoauszug
-- hochladen und er aktualisiert“). Kontoumsätze aus Auszug-PDF / George-CSV, Kontostände je Auszug, geplante Posten
-- (Fixkosten, Finanzamt, Steuerberater, privat) und die Zahlungsaufforderungen des Steuerberaters.

-- Einzelne Umsätze von Girokonto und Kreditkarte. schluessel verhindert Doppelte bei überlappenden Uploads.
create table if not exists crm.liq_buchungen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  konto text not null check (konto in ('giro', 'kreditkarte')),
  datum date not null,
  betrag numeric(12,2) not null,          -- Ausgabe negativ
  partner text,
  text text,
  quelle text not null default 'csv',     -- csv | pdf
  schluessel text not null unique,
  erstellt_am timestamptz not null default now()
);
create index if not exists liq_buchungen_datum on crm.liq_buchungen (konto, datum);

-- Kontostand laut Auszug – Startpunkt der Vorschau (nie aus Umsätzen aufsummiert).
create table if not exists crm.liq_auszuege (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  konto text not null default 'giro',
  stand_am date not null,
  saldo numeric(12,2) not null,
  bezeichnung text,
  erstellt_am timestamptz not null default now(),
  unique (konto, stand_am)
);

-- Geplante Zahlungen. intervall_monate: 0 = einmalig, 1 = monatlich, 3 = Quartal, 12 = jährlich …
-- naechste_am ist der erste (noch kommende) Termin, von dort wird weitergezählt.
-- muster: Textstück, an dem der Posten im Kontoauszug erkannt wird (ersetzt dann die automatische Erkennung).
create table if not exists crm.liq_posten (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  gruppe text not null default 'fix',     -- fix | finanzamt | steuerberater | einnahme | privat
  bezeichnung text not null,
  betrag numeric(12,2) not null,          -- Ausgabe negativ, Eingang positiv
  intervall_monate int not null default 1,
  naechste_am date not null,
  bis_am date,
  privat boolean not null default false,  -- privat: eigene Übersicht, zählt nicht zum Firmenkonto
  aktiv boolean not null default true,    -- false = „nicht einplanen“ (blendet auch erkannte Muster aus)
  muster text,
  notiz text,
  erstellt_am timestamptz not null default now()
);

-- „Zahlung Finanzamt“-Mails vom Steuerberater (Nora Lindschinger): Zahllast je Fälligkeit.
create table if not exists crm.liq_steuer (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  steuernummer text not null check (steuernummer in ('firma', 'privat')),
  faellig_am date not null,
  u_monat date,                           -- Monat, für den die Umsatzsteuer gilt (1. des Monats)
  u_betrag numeric(12,2),                 -- negativ = Gutschrift
  k_betrag numeric(12,2),                 -- KöSt-Vorauszahlung (Firma)
  e_betrag numeric(12,2),                 -- ESt-Vorauszahlung (privat)
  gesamt numeric(12,2) not null,
  notiz text,
  erstellt_am timestamptz not null default now(),
  unique (steuernummer, faellig_am)
);

alter table crm.liq_buchungen enable row level security;
alter table crm.liq_auszuege enable row level security;
alter table crm.liq_posten enable row level security;
alter table crm.liq_steuer enable row level security;
create policy liq_buchungen_inhaber on crm.liq_buchungen for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
create policy liq_auszuege_inhaber on crm.liq_auszuege for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
create policy liq_posten_inhaber on crm.liq_posten for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
create policy liq_steuer_inhaber on crm.liq_steuer for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
grant select, insert, update, delete on crm.liq_buchungen, crm.liq_auszuege, crm.liq_posten, crm.liq_steuer to authenticated;
