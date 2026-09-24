-- Roboter 2.2: Datenbank-Änderungen selbst einspielen + YOLO-Modus je Kunde.
--
-- Neue Stufen:
--   db_pruefen  – Datenbank-Änderung (erneut) prüfen und einspielen (z. B. ältere Aufträge)
--   db_freigabe – die Änderung verändert Bestehendes: wartet auf Christophs Knopfdruck
--   db_live     – freigegeben: Roboter sichert, spielt ein und schaltet live
alter table crm.roboter_auftraege drop constraint if exists roboter_auftraege_status_check;
alter table crm.roboter_auftraege add constraint roboter_auftraege_status_check check (status in
  ('analyse','vorschlag','aendern','freigegeben','in_arbeit','vorschau','live','erledigt','abgelehnt',
   'verworfen','wartet','fehler','db_pruefen','db_freigabe','db_live'));

alter table crm.roboter_auftraege add column if not exists db_info text;   -- Klartext: was sich in der Datenbank ändert
alter table crm.roboter_auftraege add column if not exists db_hash text;   -- Prüfsumme der gezeigten Migrationen (OK gilt nur dafür)
alter table crm.roboter_auftraege add column if not exists yolo boolean not null default false;   -- ohne Freigabe umgesetzt

-- Einstellungen je App/Kunde (app_key wie in crm.app_wuensche).
create table if not exists crm.roboter_apps (
  app_key       text primary key,
  yolo          boolean not null default false,   -- neue Wünsche sofort umsetzen, ohne Freigabe
  aktualisiert  timestamptz not null default now()
);
alter table crm.roboter_apps enable row level security;
drop policy if exists roboter_apps_alle on crm.roboter_apps;
create policy roboter_apps_alle on crm.roboter_apps for all to authenticated using (true) with check (true);
grant select, insert, update on crm.roboter_apps to authenticated;

-- Der eine Claude-Verlauf je Projekt, in dem Roboter und Christoph (VS Code) schreiben.
alter table crm.roboter_apps add column if not exists sitzung text;
alter table crm.roboter_apps add column if not exists sitzung_aktualisiert timestamptz;

-- aktualisiert = Zeitpunkt des letzten YOLO-Umschaltens (Datenbank-Uhr), egal wer schreibt.
create or replace function crm.roboter_apps_umschaltzeit() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.yolo is distinct from old.yolo then
    new.aktualisiert := now();
  else
    new.aktualisiert := old.aktualisiert;
  end if;
  return new;
end $$;
drop trigger if exists roboter_apps_umschaltzeit on crm.roboter_apps;
create trigger roboter_apps_umschaltzeit before insert or update on crm.roboter_apps
  for each row execute function crm.roboter_apps_umschaltzeit();
-- Name des Claude-Verlaufs, wie der Roboter ihn angelegt hat („Roboter · …“) – für den Hinweis in Telegram/CRM.
alter table crm.roboter_apps add column if not exists sitzung_name text;
