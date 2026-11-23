-- QR-Codes in Briefaktionen auswerten (23.11.2026, Christoph: „im Cockpit eine Auswertung, wann welcher QR-Code
-- angeschaut wurde und wie oft“). Jeder Brief bekommt einen eigenen Code (epowergmbh.at/q/<code>); die Website meldet
-- jeden Aufruf an die Edge Function brief-qr, die ihn hier speichert (Service-Rolle). Lesen nur der Inhaber.
create table if not exists crm.brief_qr (
  code text primary key,
  kampagne text not null,
  firma text,
  empfaenger text,
  strasse text,
  plz text,
  ort text,
  runde text,
  erstellt_am timestamptz not null default now()
);

create table if not exists crm.brief_qr_scans (
  id bigint generated always as identity primary key,
  code text not null,
  kampagne text,
  gescannt_am timestamptz not null default now(),
  geraet text,
  user_agent text,
  bot boolean not null default false
);
create index if not exists brief_qr_scans_code on crm.brief_qr_scans (code);
create index if not exists brief_qr_scans_zeit on crm.brief_qr_scans (gescannt_am desc);

alter table crm.brief_qr enable row level security;
alter table crm.brief_qr_scans enable row level security;
create policy brief_qr_inhaber on crm.brief_qr for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
create policy brief_qr_scans_inhaber on crm.brief_qr_scans for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
grant select, insert, update, delete on crm.brief_qr, crm.brief_qr_scans to authenticated;
