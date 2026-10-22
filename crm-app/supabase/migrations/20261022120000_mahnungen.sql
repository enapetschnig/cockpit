-- Mahnwesen: jede Zahlungserinnerung / Mahnung, die als PDF erstellt wurde
-- (Christoph schickt sie selbst – das CRM verschickt nichts). Die Rechnung
-- bekommt dabei den Status „überfällig“ und einen Vermerk.
create table if not exists crm.mahnungen (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references crm.documents (id) on delete cascade,
  stufe        int not null check (stufe between 1 and 3),   -- 1 Zahlungserinnerung · 2 Mahnung · 3 Letzte Mahnung
  datum        date not null default current_date,
  frist        date,
  offen        numeric not null default 0,                   -- offener Betrag (brutto) zum Zeitpunkt der Mahnung
  sperre       boolean not null default false,               -- Deaktivierung der Software angedroht
  text         text not null,
  erstellt_am  timestamptz not null default now()
);
create index if not exists mahnungen_document on crm.mahnungen (document_id, datum desc);

alter table crm.mahnungen enable row level security;
drop policy if exists mahnungen_alle on crm.mahnungen;
create policy mahnungen_alle on crm.mahnungen for all to authenticated using (true) with check (true);
grant select, insert, update, delete on crm.mahnungen to authenticated;
