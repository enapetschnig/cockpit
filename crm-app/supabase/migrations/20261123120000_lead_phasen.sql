-- Pipeline-Spalten im CRM selbst bearbeiten (23.11.2026, Christoph: „dass ich die Pipelines auch selbst bearbeiten kann
-- … und bestehende Pipelines verändern kann“). Bisher fest im Code; jetzt Name, Farbe, Reihenfolge, ausblenden und
-- eigene Spalten. leads.stage bleibt Text und zeigt auf schluessel. Die 10 bisherigen Spalten sind „fest“ (Kennzahlen,
-- Rückrufe, Heute rechnen mit won/lost/meeting_*): umbenennen/umfärben/ausblenden ja, löschen nein.
create table if not exists crm.lead_phasen (
  schluessel text primary key,
  name text not null,
  farbe text not null default '#64748b',
  reihenfolge int not null default 0,
  ausgeblendet boolean not null default false,
  fest boolean not null default false,
  user_id uuid not null default auth.uid(),
  erstellt_am timestamptz not null default now()
);

alter table crm.lead_phasen enable row level security;
create policy lead_phasen_inhaber on crm.lead_phasen for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
grant select, insert, update, delete on crm.lead_phasen to authenticated;

-- Feste Spalten nicht löschbar (auch nicht per API).
create or replace function crm.lead_phasen_fest_schuetzen() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.fest then raise exception 'Diese Spalte ist fest und kann nur ausgeblendet werden.'; end if;
  return old;
end $$;
create or replace trigger lead_phasen_fest_schuetzen before delete on crm.lead_phasen
  for each row execute function crm.lead_phasen_fest_schuetzen();

insert into crm.lead_phasen (schluessel, name, farbe, reihenfolge, ausgeblendet, fest, user_id) values
  ('new', 'Neu', '#3b82f6', 10, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('contacted', 'Erstkontakt', '#f59e0b', 20, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('follow_up', 'Follow Up', '#f97316', 30, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('qualified', 'Qualifiziert', '#22c55e', 40, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('unqualified', 'Unqualifiziert', '#64748b', 50, true, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('meeting_scheduled', 'Termin geplant', '#06b6d4', 60, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('meeting_done', 'Termin erfolgt', '#14b8a6', 70, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('no_show', 'Nicht erschienen', '#ec4899', 80, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('won', 'Verkauft', '#059669', 90, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751'),
  ('lost', 'Verloren', '#ef4444', 100, false, true, '83edc9c7-26a7-4f56-8806-cdfe253b9751')
on conflict (schluessel) do nothing;
