-- Änderungswunsch-Roboter (läuft am Windows-PC): je Kunde ein Auftrag, der
-- einen oder mehrere Wünsche bündelt. Ablauf: analyse → vorschlag →
-- (freigegeben → in_arbeit → vorschau → live → erledigt) | aendern | abgelehnt.
-- Christoph gibt im CRM unter „Wünsche“ frei; der Roboter liest und schreibt
-- über die Supabase-Verwaltungsschnittstelle.
create table if not exists crm.roboter_auftraege (
  id              uuid primary key default gen_random_uuid(),
  app_key         text not null,
  wunsch_ids      uuid[] not null,
  status          text not null default 'analyse' check (status in
                    ('analyse','vorschlag','aendern','freigegeben','in_arbeit','vorschau',
                     'live','erledigt','abgelehnt','verworfen','wartet','fehler')),
  vorschlag       text,          -- wie Claude es lösen würde (für Christoph)
  aufwand         text,          -- klein / mittel / groß
  risiko          text,
  datenbank       boolean not null default false,  -- braucht eine Datenbank-Änderung
  antwort_kunde   text,          -- Antwort, die der Kunde nach „live“ in seiner App sieht
  anmerkung       text,          -- Christophs Änderungswunsch zum Vorschlag / zur Vorschau
  zweig           text,
  vorschau_url    text,
  fehler          text,
  protokoll       text,
  erstellt_am     timestamptz not null default now(),
  aktualisiert    timestamptz not null default now(),
  freigegeben_am  timestamptz,
  live_am         timestamptz
);
create index if not exists roboter_auftraege_status on crm.roboter_auftraege (status);

-- Lebenszeichen des Roboters (eine Zeile) – das CRM zeigt, ob er läuft.
create table if not exists crm.roboter_puls (
  id        int primary key default 1 check (id = 1),
  zuletzt   timestamptz,
  version   text,
  meldung   text
);
insert into crm.roboter_puls (id) values (1) on conflict do nothing;

alter table crm.roboter_auftraege enable row level security;
alter table crm.roboter_puls enable row level security;
drop policy if exists roboter_auftraege_alle on crm.roboter_auftraege;
create policy roboter_auftraege_alle on crm.roboter_auftraege for all to authenticated using (true) with check (true);
drop policy if exists roboter_puls_lesen on crm.roboter_puls;
create policy roboter_puls_lesen on crm.roboter_puls for select to authenticated using (true);
grant select, insert, update on crm.roboter_auftraege to authenticated;
grant select on crm.roboter_puls to authenticated;

-- Welche Stufe schon per Telegram gemeldet wurde (je Stufe nur einmal; /api/roboter-melden)
alter table crm.roboter_auftraege add column if not exists gemeldet text;
