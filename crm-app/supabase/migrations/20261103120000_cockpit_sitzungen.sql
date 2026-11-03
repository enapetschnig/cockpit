-- Claude-Sitzungen am Handy (03.11.2026, Christoph: „auf die App draufklicken, das reinschreiben und dann sehe ich den
-- Claude-Verlauf … eigene Sitzungen starten … ohne VS Code per SSH“).
-- Das Cockpit schreibt nur hier hinein; der Roboter auf der Devbox holt neue Nachrichten ab, lässt Claude in seiner
-- Arbeitskopie der App arbeiten und spiegelt den Verlauf (die .jsonl-Datei von Claude) Eintrag für Eintrag zurück.
-- Dieselben Verläufe öffnet Christoph weiterhin in VS Code (Projektordner → Claude → Verläufe).

-- Eine Zeile je Claude-Verlauf einer App: im Cockpit begonnen, vom Roboter oder aus VS Code (die listet der Roboter).
create table if not exists crm.cockpit_sitzungen (
  id uuid primary key default gen_random_uuid(),
  app_key text not null,
  titel text not null default 'Neue Sitzung',
  herkunft text not null default 'cockpit' check (herkunft in ('cockpit', 'vscode', 'roboter')),
  claude_sitzung text unique,              -- Claude-Sitzungsnummer (Dateiname der .jsonl)
  datei text,                              -- wo der Verlauf am Rechner liegt (setzt der Roboter)
  status text not null default 'bereit' check (status in ('bereit', 'wartet', 'laeuft', 'fehler')),
  hinweis text,                            -- z. B. „wartet, bis der Roboter-Auftrag fertig ist“
  abbrechen boolean not null default false,
  gelesen_bis bigint not null default 0,   -- bis zu diesem Byte hat der Roboter den Verlauf gespiegelt
  beobachten_bis timestamptz,              -- im Cockpit offen → Roboter spiegelt neue Einträge auch ohne eigenen Lauf
  zuletzt timestamptz not null default now(),
  erstellt_am timestamptz not null default now()
);
create index if not exists cockpit_sitzungen_app on crm.cockpit_sitzungen (app_key, zuletzt desc);

create table if not exists crm.cockpit_nachrichten (
  id bigint generated always as identity primary key,
  sitzung_id uuid not null references crm.cockpit_sitzungen(id) on delete cascade,
  rolle text not null check (rolle in ('du', 'claude', 'werkzeug', 'info')),
  text text not null,
  -- nur bei Nachrichten aus dem Cockpit: neu → in_arbeit → erledigt | fehler
  status text check (status in ('neu', 'in_arbeit', 'erledigt', 'fehler')),
  erstellt_am timestamptz not null default now()
);
create index if not exists cockpit_nachrichten_sitzung on crm.cockpit_nachrichten (sitzung_id, id);
create index if not exists cockpit_nachrichten_neu on crm.cockpit_nachrichten (erstellt_am) where status = 'neu';

-- Fernbedienung: Pause/Weiter je App oder „alle“ – der Roboter führt aus und hakt ab.
create table if not exists crm.roboter_befehle (
  id uuid primary key default gen_random_uuid(),
  befehl text not null check (befehl in ('pause', 'weiter')),
  app_key text not null,                   -- App oder 'alle'
  minuten integer,
  erstellt_am timestamptz not null default now(),
  erledigt_am timestamptz,
  ergebnis text
);

-- Was der Roboter gerade tut und was pausiert ist – fürs Cockpit (puls, jede Minute und nach jedem Befehl).
alter table crm.roboter_puls add column if not exists pausen jsonb not null default '{}'::jsonb;
alter table crm.roboter_puls add column if not exists laeuft jsonb not null default '[]'::jsonb;

alter table crm.cockpit_sitzungen enable row level security;
alter table crm.cockpit_nachrichten enable row level security;
alter table crm.roboter_befehle enable row level security;
create policy cockpit_sitzungen_inhaber on crm.cockpit_sitzungen for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
create policy cockpit_nachrichten_inhaber on crm.cockpit_nachrichten for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
create policy roboter_befehle_inhaber on crm.roboter_befehle for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
