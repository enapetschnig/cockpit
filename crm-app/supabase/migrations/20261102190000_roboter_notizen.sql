-- Notizen des Roboters für den Tagesstand um 7 und 18 Uhr (02.11.2026, Christoph: „nicht immer Telegram-Nachrichten …
-- nur, wenn etwas nicht funktioniert“). Was nicht sofort ein Notfall ist (zurückgerollt, App-Check, Nachtschicht,
-- Fehlerprotokolle), schreibt der Roboter hier hinein; das Cockpit fasst es zweimal am Tag zusammen.
create table if not exists crm.roboter_notizen (
  id uuid primary key default gen_random_uuid(),
  art text not null,              -- zurueckgerollt | appcheck | nachtschicht | fehlerprotokoll | notfall
  app_key text,
  text text not null,
  erstellt_am timestamptz not null default now(),
  im_tagesstand_am timestamptz
);
create index if not exists roboter_notizen_offen on crm.roboter_notizen (erstellt_am) where im_tagesstand_am is null;
alter table crm.roboter_notizen enable row level security;
create policy roboter_notizen_inhaber on crm.roboter_notizen for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
alter table crm.roboter_notizen add column if not exists gemeldet_am timestamptz; -- Notfall genau einmal sofort per Telegram
