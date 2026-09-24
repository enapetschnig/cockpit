-- Fragen an den Änderungswunsch-Roboter (aus dem Telegram-Bot).
-- Der Bot legt die Frage an, der Roboter am PC beantwortet sie mit Claude im
-- Projektordner (kennt den Code, ändert nichts) und meldet die Antwort über das
-- Cockpit (/api/roboter/melden) zurück an Telegram.
create table if not exists crm.roboter_fragen (
  id              uuid primary key default gen_random_uuid(),
  app_key         text not null,
  auftrag_id      uuid references crm.roboter_auftraege(id) on delete set null,
  frage           text not null,
  antwort         text,
  status          text not null default 'neu' check (status in ('neu','in_arbeit','beantwortet','fehler')),
  gemeldet        boolean not null default false,
  erstellt_am     timestamptz not null default now(),
  beantwortet_am  timestamptz
);
create index if not exists roboter_fragen_offen on crm.roboter_fragen (erstellt_am) where status = 'neu';

alter table crm.roboter_fragen enable row level security;
drop policy if exists roboter_fragen_alle on crm.roboter_fragen;
create policy roboter_fragen_alle on crm.roboter_fragen for all to authenticated using (true) with check (true);
grant select, insert, update on crm.roboter_fragen to authenticated;
